import { 
  JobContext, 
  WorkerOptions, 
  cli, 
  defineAgent, 
  voice,
  llm // <--- Import llm directly as a named export
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import 'dotenv/config';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    try {
      await ctx.connect();
      console.log(`CONNECTED to room: ${ctx.room.name}`);

      // SUCCESS: Accessing ChatContext and ChatRole via the named import
      const chatContext = new llm.ChatContext().append({
        role: llm.ChatRole.SYSTEM, // This will no longer be undefined
        text: "You are Veronica, a helpful AI assistant. Keep responses brief.",
      });

      const agent = new voice.VoicePipelineAgent(
        new deepgram.STT(), 
        new openai.LLM({ model: 'gpt-4o-mini' }), 
        new openai.TTS(),
        { chatContext }
      );

      agent.start(ctx.room);
      await agent.say("I am online. How can I help you, Daniel?");

    } catch (error) {
      console.error("FATAL ERROR:", error);
    }
  },
});

cli.runApp(new WorkerOptions({ agent: './agent.ts' }));
