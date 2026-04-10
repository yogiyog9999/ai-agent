import { 
  JobContext, 
  WorkerOptions, 
  cli, 
  defineAgent, 
  voice,
  llm // ChatContext and ChatRole are now here
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import 'dotenv/config';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    try {
      await ctx.connect();
      console.log(`CONNECTED to room: ${ctx.room.name}`);

      // 1. Setup Chat Context correctly from the 'llm' namespace
      const chatContext = new llm.ChatContext().append({
        role: llm.ChatRole.SYSTEM,
        text: "You are Veronica, a professional voice assistant. Keep answers concise.",
      });

      // 2. Initialize the Voice Agent
      const agent = new voice.VoicePipelineAgent(
        new deepgram.STT(), 
        new openai.LLM({ model: 'gpt-4o-mini' }), 
        new openai.TTS(),
        { chatContext }
      );

      // 3. Start and greet
      console.log("Starting Veronica...");
      agent.start(ctx.room);
      
      await agent.say("Hello Daniel, I am online and ready to assist you.");
      console.log("Agent is now live and listening!");

    } catch (error) {
      console.error("FATAL ERROR IN AGENT:", error);
    }
  },
});

cli.runApp(new WorkerOptions({ agent: './agent.ts' }));
