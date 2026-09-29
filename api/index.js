const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

// 1. Pune aici link-urile tale M3U8
const M3U8_URLS = [
    "http://hotmtk.go.ro/iptv/wlog.m3u",
    "https://iptv-org.github.io/iptv/countries/ro.m3u"
];

// Memory cache temporar
let channelsCache = [];
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minute

function parseM3U(content) {
    const lines = content.split(/\r?\n/);
    const channels = [];
    let currentName = null;
    let currentLogo = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith("#EXTINF:")) {
            const commaIndex = line.lastIndexOf(",");
            if (commaIndex !== -1) {
                currentName = line.substring(commaIndex + 1).trim();
            }

            const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
            if (logoMatch) {
                currentLogo = logoMatch[1];
            } else {
                currentLogo = "https://via.placeholder.com/300x450.png?text=TV";
            }
        } else if (line && !line.startsWith("#")) {
            if (currentName) {
                const id = "m3u8_ch_" + Buffer.from(currentName).toString("hex").substring(0, 16);
                channels.push({
                    id: id,
                    name: currentName,
                    logo: currentLogo,
                    url: line
                });
            }
            currentName = null;
            currentLogo = "";
        }
    }
    return channels;
}

async function getUpdatedChannels() {
    const now = Date.now();
    if (channelsCache.length > 0 && (now - lastFetchTime) < CACHE_TTL) {
        return channelsCache;
    }

    const allChannels = [];
    for (const url of M3U8_URLS) {
        try {
            const response = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            if (response.ok) {
                const text = await response.text();
                const parsed = parseM3U(text);
                allChannels.push(...parsed);
            }
        } catch (err) {
            console.error(`Eroare la descărcarea ${url}:`, err.message);
        }
    }

    // Eliminare duplicate
    const uniqueChannels = Array.from(
        new Map(allChannels.map(item => [item.name, item])).values()
    );

    // Sortare alfabetică
    uniqueChannels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    channelsCache = uniqueChannels;
    lastFetchTime = now;
    return channelsCache;
}

// 2. Manifestul
const manifest = {
    id: "org.rostreamtv.addon",
    version: "1.0.0",
    name: "RoStreamTV",
    description: "Canale TV Live concatenate din surse M3U8",
    resources: ["catalog", "stream"],
    types: ["tv"],
    catalogs: [
        {
            type: "tv",
            id: "m3u8_channels",
            name: "RoStreamTV Live"
        }
    ]
};


const builder = new addonBuilder(manifest);

// 3. Catalog Handler
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === "tv" && id === "m3u8_channels") {
        const channels = await getUpdatedChannels();
        const metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name,
            poster: ch.logo,
            description: `Stream live: ${ch.name}`
        }));
        return { metas };
    }
    return { metas: [] };
});

// 4. Stream Handler
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "tv") {
        const channels = await getUpdatedChannels();
        const found = channels.find(ch => ch.id === id);

        if (found) {
            return {
                streams: [
                    {
                        title: "Live Stream",
                        url: found.url
                    }
                ]
            };
        }
    }
    return { streams: [] };
});

// 5. Exportăm router-ul pentru Vercel (Serverless)
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

module.exports = (req, res) => {
    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};



