import { 
  JobContext, 
  WorkerOptions, 
  cli, 
  defineAgent, 
  voice,
  llm
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import 'dotenv/config';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    // 1. Establish the WebRTC connection
    await ctx.connect();
    console.log(`Agent "Veronica" connected to room: ${ctx.room.name}`);

    // 2. Build the AI Pipeline (The "Brain" and "Voice")
    const agent = new voice.VoicePipelineAgent(
      new deepgram.STT(), // Speech-to-Text (Fastest in 2026)
      new openai.LLM({ model: 'gpt-4o-mini' }), // Cost-effective brain
      new openai.TTS(), // Natural voice output
      {
        chatContext: new llm.ChatContext().append({
          role: llm.ChatRole.SYSTEM,
          text: "You are Veronica, a professional AI assistant. Keep responses short and helpful.",
        }),
      }
    );

    // 3. Join and greet the user
    agent.start(ctx.room);
    await agent.say("Hello Daniel, I'm online and ready to help.");
  },
});

// Start the agent worker
cli.runApp(new WorkerOptions({ agent: './agent.ts' }));
