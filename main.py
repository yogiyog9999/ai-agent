import logging
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

async def entrypoint(ctx: JobContext):
    await ctx.connect()
    
    # 1. Initialize the Voice Session using the newer inference patterns
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-2"),
        llm=inference.LLM(model="openai/gpt-4o-mini"),
        tts=inference.TTS(model="deepgram/aura-2-thalia-en"),
        vad=silero.VAD.load(),
    )

    # 2. Define the Agent's personality
    veronica = Agent(
        instructions=(
            "You are Veronica, a helpful assistant for Dlist Software. "
            "Keep replies brief (1-2 sentences) and use natural fillers like 'uh' or 'hmm'."
        )
    )

    # 3. Start the session
    await session.start(room=ctx.room, agent=veronica)

    # 4. Professional Greeting
    await session.generate_reply(
        instructions="Greet the user warmly as Veronica from Dlist Software."
    )

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
