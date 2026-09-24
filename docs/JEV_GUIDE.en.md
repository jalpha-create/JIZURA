# Using Jev (β)

Jev chooses a mood, style, and per-line layout, entrance, and exit effects to suit your lyrics. You can also provide optional directions in natural language. The rest of JIZURA works without an API key or local server.

## Setup

1. Obtain a TypeSafe Jev API key.
2. Download or clone this repository to your computer and install Python 3. No extra Python packages are needed.
3. In the repository root, set the API key as an environment variable and start the server.

PowerShell:

```powershell
$env:TYPESAFE_API_KEY = 'your-key'
python jev_server.py
```

macOS / Linux:

```sh
TYPESAFE_API_KEY='your-key' python3 jev_server.py
```

Leave the server running and open the [JIZURA fork](https://hirazisora.github.io/JIZURA/en/). Enter lyrics, optionally add directions below the lyrics box, and press **Create with Jev (β)**. The button is available in both Simple and Advanced modes.

From GitHub Pages, your browser connects to `http://127.0.0.1:8765/api/jev` on your computer. Allow local network access if the browser asks. If the Pages connection does not work, open `http://127.0.0.1:8765/en/` on the same computer instead.

## Data sent to Jev

The Jev API receives lyrics, song title, artist name, optional directions, and the available choices. Audio files and uploaded images or videos are not sent. The API key stays in the local server's environment; it is not saved in the browser or project file. If selection fails, your current arrangement stays as it is.

## If Jev cannot connect

- Check that `jev_server.py` is running.
- Check that `TYPESAFE_API_KEY` is set in the terminal running the server.
- Allow local network access in your browser.
- Try the local `127.0.0.1` page above if Pages cannot connect.

[日本語のガイド](JEV_GUIDE.md)
