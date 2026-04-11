import asyncio
import logging
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli, llm
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import openai, deepgram, silero

load_dotenv()
logger = logging.getLogger("voice-agent")

# --- DEMO CONFIGURATION ---
# Change this data depending on which client you are pitching to!
CLIENT_DATA = {
    "name": "Veronica",
    "company": "Dlist Software",
    "knowledge": """
    - We build custom WordPress plugins and Ionic mobile apps.
    - Our pricing starts at $500 for small projects.
    - We are open Monday to Friday, 9 AM to 6 PM.
    - We offer a free 15-minute consultation.
    """
}

async def entrypoint(ctx: JobContext):
    # 1. Setup the Chat Context (The "Brain")
    initial_ctx = llm.ChatContext().append(
        role="system",
        text=(
            f"You are {CLIENT_DATA['name']}, a friendly human assistant for {CLIENT_DATA['company']}.\n"
            "Keep answers brief (1-2 sentences). Use human fillers like 'uh' or 'hmm' occasionally.\n"
            f"Use this info to help: {CLIENT_DATA['knowledge']}\n"
            "If you don't know an answer, say you'll have a human team member call them back."
        ),
    )

    # 2. Connect to the LiveKit Room
    await ctx.connect()
    logger.info(f"Connected to room: {ctx.room.name}")

    # 3. Initialize the Voice Assistant
    assistant = VoiceAssistant(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="nova-2", language="en-IN"),
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=deepgram.TTS(model="aura-2-thalia-en"), # High-quality natural voice
        chat_ctx=initial_ctx,
        allow_interruptions=True,
        interrupt_speech_duration=0.5,
        preemptive_response=True
    )

    # 4. Start the session
    assistant.start(ctx.room)

    # 5. Professional Greeting
    await assistant.say(
        f"Hi! Thanks for calling {CLIENT_DATA['company']}. I'm {CLIENT_DATA['name']}. How can I help you today?",
        allow_interruptions=True
    )

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
