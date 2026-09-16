# Feedback Script Generator

A tool for managers who need to give someone difficult feedback and want help finding the right words before the conversation happens.

## What it does

A manager describes one moment — what happened, the impact it had, and what they'd like to see instead — and the tool drafts a complete, ready-to-use script for the conversation. Every script follows the same five-part structure:

1. **A quick check-in** that asks permission to raise the topic, rather than launching straight into it
2. **The specific moment**, named clearly and without judgment
3. **The impact** that moment had
4. **A clear recommendation** for what to do differently going forward
5. **A two-part close** — inviting the other person's perspective on the issue, and separately asking how the feedback itself landed

Along the way it also predicts a likely pushback the other person might give, and suggests how to respond to it.

## What makes it adaptable

Before generating, the manager chooses:

- **Relationship context** — direct report, peer, or someone senior to them
- **Tone** — direct, coaching, or supportive
- **Geography** — US, Europe, Asia, or Middle East/Africa, which shifts how directly or formally the script is phrased to fit workplace norms in that region

Any of these can be changed afterward to instantly redraft the same script in a different tone or for a different region, without retyping the original details.

## How it works

This is a small web app: a simple front end where the manager fills in the details, and a lightweight backend that sends those details to Claude (Anthropic's AI model) and returns a structured script. The backend keeps the API key private and limits how many scripts each visitor can generate per day, so usage stays predictable.

## Running it

1. Set an `ANTHROPIC_API_KEY` environment variable (from an Anthropic account) wherever this is hosted.
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Open the app in a browser — it's served from the same address.
