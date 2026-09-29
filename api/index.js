const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const M3U8_URLS = [
    "http://hotmtk.go.ro/iptv/wlog.m3u",
    "https://iptv-org.github.io/iptv/countries/ro.m3u"
    "https://iptv-org.github.io/iptv/countries/md.m3u"
    "http://hotmtk.go.ro/iptv/BEE.m3u8"
];

let channelsCache = [];
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minute

function parseM3U(content, sourceIndex) {
    const lines = content.split(/\r?\n/);
    const channels = [];
    let currentName = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith("#EXTINF:")) {
            const commaIndex = line.lastIndexOf(",");
            if (commaIndex !== -1) {
                currentName = line.substring(commaIndex + 1).trim();
            }
        } else if (line && !line.startsWith("#")) {
            if (currentName) {
                channels.push({
                    name: currentName,
                    url: line,
                    sourceIndex: sourceIndex + 1
                });
            }
            currentName = null;
        }
    }
    return channels;
}

async function getUpdatedChannels() {
    const now = Date.now();
    if (channelsCache.length > 0 && (now - lastFetchTime) < CACHE_TTL) {
        return channelsCache;
    }

    const rawChannels = [];
    for (let i = 0; i < M3U8_URLS.length; i++) {
        const url = M3U8_URLS[i];
        try {
            const response = await fetch(url, {
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            if (response.ok) {
                const text = await response.text();
                const parsed = parseM3U(text, i);
                rawChannels.push(...parsed);
            }
        } catch (err) {
            console.error(`Eroare la ${url}:`, err.message);
        }
    }

    // Fără grupări: generăm câte o intrare unică pentru FIECARE canal găsit
    const processedChannels = rawChannels.map((item, idx) => {
        const safeHex = Buffer.from(item.name).toString("hex").substring(0, 10);
        const id = `rostreamtv_s${item.sourceIndex}_${idx}_${safeHex}`;

        return {
            id: id,
            name: item.name,
            url: item.url,
            sourceIndex: item.sourceIndex
        };
    });

    // Sortare alfabetică directă
    processedChannels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    channelsCache = processedChannels;
    lastFetchTime = now;
    return channelsCache;
}

// 1. Manifest
const manifest = {
    id: "org.rostreamtv.addon",
    version: "1.3.0",
    name: "RoStreamTV",
    description: "Canale TV Live individuale din surse M3U8 (Text Only)",
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

// 2. Catalog Handler (Afișează toate canalele, inclusiv duplicatele)
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === "tv" && id === "m3u8_channels") {
        const channels = await getUpdatedChannels();
        const metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name,
            posterShape: "square",
            description: `Sursa ${ch.sourceIndex}`
        }));
        return { metas };
    }
    return { metas: [] };
});

// 3. Meta Handler
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
                    description: `Transmisiune în direct pentru ${found.name} (Lista ${found.sourceIndex}).`,
                    isFree: true
                }
            };
        }
    }
    return { meta: null };
});

// 4. Stream Handler (Un singur stream direct per canal)
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "tv") {
        const channels = await getUpdatedChannels();
        const found = channels.find(ch => ch.id === id);

        if (found) {
            return {
                streams: [
                    {
                        title: `Play ${found.name}`,
                        url: found.url
                    }
                ]
            };
        }
    }
    return { streams: [] };
});

// 5. Export Vercel
const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);

module.exports = (req, res) => {
    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};
