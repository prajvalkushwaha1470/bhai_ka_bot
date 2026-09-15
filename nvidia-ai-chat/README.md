# NVIDIA AI Chat

A complete local web chat starter powered by NVIDIA NIM. The API key stays on the server; it is never sent to browser code.

## Requirements
- Node.js 18 or newer
- An NVIDIA API key from https://build.nvidia.com/

## Run it
1. Extract this ZIP.
2. Open the extracted `nvidia-ai-chat` folder in VS Code.
3. Copy `.env.example` and rename the copy to `.env`.
4. Open `.env` and replace `your_nvidia_api_key_here` with your NVIDIA API key.
5. In the VS Code terminal, run:

   ```bash
   npm install
   npm start
   ```

6. Open http://localhost:3000

## Model
The default model is `meta/llama-3.3-70b-instruct`. If that model is not available to your NVIDIA account, change `NVIDIA_MODEL` in `.env` to a model identifier shown in your NVIDIA API Catalog. Restart the server after changing `.env`.

## Included
- Responsive chat UI with recent chats (in-memory for this browser session)
- Streaming responses
- New/clear chat, suggestion prompts, code formatting
- Server-side API key handling and readable API error messages

## Notes
- Chat history is held in browser memory and is cleared when you refresh or close the page.
- API access, rate limits, and model availability depend on your NVIDIA account.
- Never commit or share your `.env` file. The `.gitignore` excludes it.
