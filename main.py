import logging
import httpx  # Added for web scraping
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
    inference,
)
from livekit.plugins import openai, deepgram, silero

load_dotenv()
logger = logging.getLogger("veronica-agent")

# --- KNOWLEDGE FETCHER ---
async def get_website_knowledge(url: str) -> str:
    """Fetches clean text from a URL using Jina Reader."""
    try:
        # Prepending r.jina.ai turns the website into clean text for the LLM
        jina_url = f"https://r.jina.ai/{url}"
        async with httpx.AsyncClient() as client:
            response = await client.get(jina_url, timeout=12.0)
            if response.status_code == 200:
                # We limit to 5000 chars to keep the prompt efficient
                return response.text[:5000]
            return "Could not read website content."
    except Exception as e:
        logger.error(f"Scraping error: {e}")
        return "No specific website knowledge available."

async def entrypoint(ctx: JobContext):
    await ctx.connect()
    
    # 1. FETCH THE KNOWLEDGE
    target_url = "https://ciprcommunications.com"
    logger.info(f"Loading knowledge from {target_url}...")
    website_data = await get_website_knowledge(target_url)

    # 2. Initialize the Voice Session
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-2"),
        llm=inference.LLM(model="openai/gpt-4o-mini"),
        tts=inference.TTS(model="deepgram/aura-2-thalia-en"),
        vad=silero.VAD.load(),
    )

    # 3. Define the Agent with the new Knowledge Base
    veronica = Agent(
        instructions=(
            f"You are Veronica, a helpful assistant for CIPR Communications ({target_url}).\n"
            f"Use this website data to answer questions: {website_data}\n\n"
            "Rules:\n"
            "- Keep replies very brief (1-2 sentences).\n"
            "- Use natural fillers like 'uh' or 'hmm'.\n"
            "- If asked about something not in the data, offer a call back from the team."
        )
    )

    # 4. Start the session
    await session.start(room=ctx.room, agent=veronica)

    # 5. Professional Greeting
    await session.generate_reply(
        instructions="Greet the user warmly as Veronica from CIPR Communications."
    )

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
