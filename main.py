import asyncio
import logging
import os
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli, voice_assistant
from livekit.plugins import openai, deepgram, silero

load_dotenv()
logger = logging.getLogger("voice-agent")

# --- MEMORY STORE (simple session memory) ---
SESSION_MEMORY = {}

async def entrypoint(ctx: JobContext):
    session_id = ctx.room.name

    # --- KNOWLEDGE BASE ---
    website_knowledge = """
    Welcome to Dlist! We are a software agency.
    Services: WordPress plugins, Ionic mobile apps.
    Pricing: Starts at $500.
    Hours: 9 AM to 6 PM IST.
    """

    # --- MEMORY ---
    history = SESSION_MEMORY.get(session_id, [])

    # --- SYSTEM PROMPT (HUMAN-LIKE) ---
    system_prompt = (
        "You are Veronica, a real human customer support agent on a phone call.\n"
        "Speak naturally, like a human — not like an AI.\n"
        "Use short sentences.\n"
        "Sometimes use fillers like 'uh', 'hmm', 'let me check'.\n"
        "Be polite, warm, and slightly conversational.\n"
        "Interrupt yourself naturally if needed.\n"
        "Never speak in paragraphs.\n"
        "Act like you're on a real call center line.\n\n"
        f"Website info:\n{website_knowledge}"
    )

    chat_ctx = openai.ChatContext().append(
        role="system",
        text=system_prompt
    )

    # Inject previous memory
    for msg in history[-6:]:
        chat_ctx.append(**msg)

    await ctx.connect()

    assistant = voice_assistant.VoiceAssistant(
        vad=silero.VAD.load(),

        # ⚡ FAST + ACCURATE STT
        stt=deepgram.STT(
            model="nova-2",
            language="en-IN",
            interim_results=True
        ),

        # 🧠 FAST LLM
        llm=openai.LLM(
            model="gpt-4o-mini",
            temperature=0.6,
            max_tokens=120
        ),

        # 🎙️ REAL HUMAN VOICE (FAST)
        tts=deepgram.TTS(
            model="aura-2-thalia-en",
        ),

        chat_ctx=chat_ctx,

        # 🔥 REAL-TIME BEHAVIOR SETTINGS
        interrupt_speech_duration=0.3,
        min_endpointing_delay=0.2,
        preemptive_response=True,
    )

    assistant.start(ctx.room)

    # --- GREETING ---
    await assistant.say(
        "Hey! Thanks for calling Dlist. Uh, how can I help you today?",
        allow_interruptions=True
    )

    # --- SAVE MEMORY LOOP ---
    async for msg in assistant.chat_stream():
        history.append(msg)
        SESSION_MEMORY[session_id] = history[-10:]  # keep last 10


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
