import { 
  JobContext, 
  WorkerOptions, 
  cli, 
  defineAgent, 
  voice,
} from '@livekit/agents';
// FIX: Import llm specifically for ChatContext and ChatRole
import { llm } from '@livekit/agents'; 
import * as openai from '@livekit/agents-plugin-openai';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import 'dotenv/config';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    try {
      await ctx.connect();
      console.log(`CONNECTED to room: ${ctx.room.name}`);

      // Now llm.ChatContext and llm.ChatRole will be defined
      const chatContext = new llm.ChatContext().append({
        role: llm.ChatRole.SYSTEM,
        text: "You are Veronica, a professional voice receptionist. Keep responses natural and brief.",
      });

      const agent = new voice.VoicePipelineAgent(
        new deepgram.STT(), 
        new openai.LLM({ model: 'gpt-4o-mini' }), 
        new openai.TTS(),
        { chatContext }
      );

      console.log("Starting Veronica...");
      agent.start(ctx.room);
      
      await agent.say("Hello Daniel, I am online and ready to assist you.");
      console.log("Agent is live!");

    } catch (error) {
      console.error("FATAL ERROR IN AGENT:", error);
    }
  },
});

cli.runApp(new WorkerOptions({ agent: './agent.ts' }));
