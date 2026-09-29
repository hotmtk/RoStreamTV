const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const M3U8_URLS = [
    "http://hotmtk.go.ro/iptv/wlog.m3u",
    "https://iptv-org.github.io/iptv/countries/ro.m3u"
];

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
                currentLogo = "https://via.placeholder.com/300x300.png?text=TV";
            }
        } else if (line && !line.startsWith("#")) {
            if (currentName) {
                // Generăm un ID unic bazat pe nume
                const id = "rostreamtv_" + Buffer.from(currentName).toString("hex").substring(0, 16);
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

    // Eliminare duplicate după nume
    const uniqueChannels = Array.from(
        new Map(allChannels.map(item => [item.name, item])).values()
    );

    // Sortare alfabetică
    uniqueChannels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    channelsCache = uniqueChannels;
    lastFetchTime = now;
    return channelsCache;
}

// 1. Manifest
const manifest = {
    id: "org.rostreamtv.addon",
    version: "1.0.0",
    name: "RoStreamTV",
    description: "Canale TV Live concatenate din surse M3U8",
    resources: ["catalog", "meta", "stream"],
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

// 2. Catalog Handler (Lista de canale)
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === "tv" && id === "m3u8_channels") {
        const channels = await getUpdatedChannels();
        const metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name,
            poster: ch.logo,
            posterShape: "square",
            description: `Canal TV Live: ${ch.name}`
        }));
        return { metas };
    }
    return { metas: [] };
});

// 3. Meta Handler (Detalii canal la click)
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === "tv") {
        const channels = await getUpdatedChannels();
        const found = channels.find(ch => ch.id === id);

        if (found) {
            return {
                meta: {
                    id: found.id,
                    type: "tv",
                    name: found.name,
                    poster: found.logo,
                    background: found.logo,
                    description: `Transmisiune în direct pentru canalul ${found.name}.`,
                    isFree: true
                }
            };
        }
    }
    return { meta: null };
});

// 4. Stream Handler (Linkul M3U8 de redare)
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "tv") {
        const channels = await getUpdatedChannels();
        const found = channels.find(ch => ch.id === id);

        if (found) {
            return {
                streams: [
                    {
                        title: `${found.name} (Live HD)`,
                        url: found.url
                    }
                ]
            };
        }
    }
    return { streams: [] };
});

// 5. Export pentru Vercel
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

module.exports = (req, res) => {
    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};

