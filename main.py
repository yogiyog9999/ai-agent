import logging
import httpx
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

async def get_website_knowledge(url: str) -> str:
    try:
        jina_url = f"https://r.jina.ai/{url}"
        async with httpx.AsyncClient() as client:
            response = await client.get(jina_url, timeout=12.0)
            return response.text[:5000] if response.status_code == 200 else ""
    except Exception:
        return ""

async def entrypoint(ctx: JobContext):
    await ctx.connect()
    
    target_url = "https://ciprcommunications.com"
    website_data = await get_website_knowledge(target_url)

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-2"),
        llm=inference.LLM(model="openai/gpt-4o-mini"),
        tts=inference.TTS(model="deepgram/aura-2-thalia-en"),
        vad=silero.VAD.load(),
    )

    # --- ENHANCED INSTRUCTIONS ---
    # We add the "Golden Facts" here so the agent is 100% accurate
    veronica = Agent(
        instructions=(
            f"You are Veronica, the AI assistant for CIPR Communications. \n"
            f"CORE KNOWLEDGE:\n"
            "- SPECIALIZATION: We specialize in Tourism, Hospitality, and Service-based businesses.\n"
            "- AI INTUITION SPRINT: This is our signature 4-session program (90 mins each) that moves teams from 'AI-curious' to 'AI-confident' through hands-on experimentation.\n"
            "- CONTACT: Clients can call us at 855-702-1357 or email peter@ciprcommunications.com.\n\n"
            f"ADDITIONAL CONTEXT FROM SITE: {website_data}\n\n"
            "RULES: Keep replies under 2 sentences. Sound professional yet friendly."
        )
    )

    await session.start(room=ctx.room, agent=veronica)
    await session.generate_reply(instructions="Greet the user as Veronica from CIPR Communications.")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
