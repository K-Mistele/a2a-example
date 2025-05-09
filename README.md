# Example A2A Server
1. Set up _Browserable_, which you can self-host: https://github.com/browserable/browserable
2. Once you have a browserable API key, set `BROWSERABLE_API_KEY` in your `.env` file.
3. Install dependencies: `bun install`
4. Run the server: `bun run dev`
5. Run valkey: `docker run -p 6379:6379 valkey/valkey:latest`

To install dependencies:
```sh
bun install
```

To run:
```sh
bun run dev
```

open http://localhost:3000
