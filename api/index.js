const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");

const SOURCES = [
    { tag: "WLOG", url: "http://hotmtk.go.ro/iptv/wlog.m3u" },
    { tag: "RO", url: "https://iptv-org.github.io/iptv/countries/ro.m3u" },
    { tag: "MD", url: "https://iptv-org.github.io/iptv/countries/md.m3u" },
    { tag: "BEE", url: "http://hotmtk.go.ro/iptv/BEE.m3u8" }
];

let channelsCache = [];
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minute

function parseM3U(content, sourceTag) {
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
                    sourceTag: sourceTag
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
    for (const source of SOURCES) {
        try {
            const response = await fetch(source.url, {
                headers: { "User-Agent": "Mozilla/5.0" }
            });
            if (response.ok) {
                const text = await response.text();
                const parsed = parseM3U(text, source.tag);
                rawChannels.push(...parsed);
            }
        } catch (err) {
            console.error(`Eroare la descarcarea sursei ${source.tag} (${source.url}):`, err.message);
        }
    }

    // Format nou: Nume Canal | SURSA
    const processedChannels = rawChannels.map((item, idx) => {
        const displayName = `${item.name} | ${item.sourceTag}`;
        const safeHex = Buffer.from(displayName).toString("hex").substring(0, 10);
        const id = `rostreamtv_${item.sourceTag.toLowerCase()}_${idx}_${safeHex}`;

        return {
            id: id,
            channelName: item.name,
            displayName: displayName,
            url: item.url,
            sourceTag: item.sourceTag
        };
    });

    processedChannels.sort((a, b) => a.channelName.localeCompare(b.channelName, undefined, { sensitivity: "base" }));

    channelsCache = processedChannels;
    lastFetchTime = now;
    return channelsCache;
}

// 1. Manifest
const manifest = {
    id: "org.rostreamtv.addon",
    version: "1.7.0",
    name: "RoStreamTV",
    description: "Canale TV Live din sursele RO, MD, WLOG si BEE",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    catalogs: [
        {
            type: "tv",
            id: "m3u8_channels",
            name: "RoStreamTV Live",
            extra: [
                {
                    name: "genre",
                    isRequired: true,
                    options: ["Toate", "RO", "MD", "WLOG", "BEE"]
                }
            ]
        }
    ]
};

const builder = new addonBuilder(manifest);

// 2. Catalog Handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type === "tv" && id === "m3u8_channels") {
        let channels = await getUpdatedChannels();

        if (extra && extra.genre && extra.genre !== "Toate") {
            channels = channels.filter(ch => ch.sourceTag === extra.genre);
        }

        const metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.displayName,
            releaseInfo: ch.sourceTag,
            genres: [ch.sourceTag],
            description: `Sursa: ${ch.sourceTag}`,
            posterShape: "square"
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
                    name: found.displayName,
                    description: `Transmisiune live furnizata de sursa ${found.sourceTag}.`,
                    isFree: true
                }
            };
        }
    }
    return { meta: null };
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
                        title: `Play ${found.displayName}`,
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
