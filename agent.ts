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
    try {
      await ctx.connect();
      console.log(`CONNECTED to: ${ctx.room.name}`);

      const agent = new voice.VoicePipelineAgent(
        new deepgram.STT(), 
        new openai.LLM({ model: 'gpt-4o-mini' }), 
        new openai.TTS(),
        {
          chatContext: new llm.ChatContext().append({
            role: llm.ChatRole.SYSTEM,
            text: "You are Veronica, a helpful assistant. Keep it short.",
          }),
        }
      );

      console.log("Starting agent...");
      agent.start(ctx.room);
      
      await agent.say("I am online. How can I help?");
      console.log("Agent is now talking and listening!");

    } catch (error) {
      // THIS WILL PRINT THE EXACT ERROR IN YOUR TERMINAL
      console.error("FATAL ERROR IN AGENT:", error);
    }
  },
});

cli.runApp(new WorkerOptions({ agent: './agent.ts' }));
