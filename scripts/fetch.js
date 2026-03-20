const https = require("https");
const fs = require("fs");
const path = require("path");

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

const CHANNELS = [
  { id: "UCcmeytqqhbJHEXM9loY7Rcg", name: "IGN Korea" },
  { id: "UCBW_PhuXoHk40xF6nO0Q64w", name: "깐" },
  { id: "UC6haqlR_OBveu10B-7_AR2w", name: "플레이타임" },
  { id: "UC7loyhgCm1NRTtyF36hO-jA", name: "게임통" },
  { id: "UCG3uX-OwJ82T3L3EhC3GPXA", name: "평균남자" },
  { id: "UCM8nQko8QzUv0M3ZzQfvTcg", name: "채널프느느" },
];

const GAME_MAP = [
  { keywords: ["발로란트", "valorant"],                          gameTag: "발로란트",         genres: ["fps"] },
  { keywords: ["리그 오브 레전드", "롤", "league of legends"],  gameTag: "리그 오브 레전드", genres: ["strategy"] },
  { keywords: ["팀파이트 택틱스", "tft"],                       gameTag: "TFT",              genres: ["strategy", "casual"] },
  { keywords: ["오버워치", "overwatch"],                         gameTag: "오버워치",         genres: ["fps"] },
  { keywords: ["배틀그라운드", "배그", "pubg"],                  gameTag: "배틀그라운드",     genres: ["fps"] },
  { keywords: ["몬스터헌터", "monster hunter"],                  gameTag: "몬스터헌터",       genres: ["rpg", "collect"] },
  { keywords: ["포켓몬", "pokemon"],                             gameTag: "포켓몬",           genres: ["rpg", "collect"] },
  { keywords: ["파이널판타지", "final fantasy", "ff14", "ff16"], gameTag: "파이널판타지",     genres: ["rpg"] },
  { keywords: ["엘든 링", "엘든링", "elden ring"],               gameTag: "엘든 링",          genres: ["rpg"] },
  { keywords: ["다크소울", "dark souls"],                        gameTag: "다크소울",         genres: ["rpg"] },
  { keywords: ["붉은사막", "red desert"],                        gameTag: "붉은사막",         genres: ["rpg"] },
  { keywords: ["팰월드", "palworld"],                            gameTag: "팰월드",           genres: ["collect", "casual"] },
  { keywords: ["마인크래프트", "minecraft"],                     gameTag: "마인크래프트",     genres: ["casual", "indie"] },
  { keywords: ["스타크래프트", "starcraft"],                     gameTag: "스타크래프트",     genres: ["strategy"] },
  { keywords: ["디아블로", "diablo"],                            gameTag: "디아블로",         genres: ["rpg"] },
  { keywords: ["사이버펑크", "cyberpunk"],                       gameTag: "사이버펑크 2077",  genres: ["rpg"] },
  { keywords: ["젤다", "zelda"],                                 gameTag: "젤다의 전설",      genres: ["rpg", "casual"] },
  { keywords: ["스팀", "steam", "인디"],                         gameTag: null,               genres: ["indie"] },
  { keywords: ["fps", "슈터", "shooter"],                        gameTag: null,               genres: ["fps"] },
  { keywords: ["rpg", "롤플레잉"],                               gameTag: null,               genres: ["rpg"] },
  { keywords: ["전략", "strategy", "rts"],                       gameTag: null,               genres: ["strategy"] },
];

function detectGenreAndGame(title) {
  const lower = title.toLowerCase();
  for (const entry of GAME_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return { genres: entry.genres, gameTag: entry.gameTag };
    }
  }
  return { genres: ["casual"], gameTag: null };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseRSS(xml, channelName, channelId) {
  const cutoff = Date.now() - FOUR_WEEKS_MS;
  const results = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const videoId   = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || "";
    const rawTitle  = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim() || "";
    const published = (block.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    if (!videoId || !rawTitle) continue;
    if (published && new Date(published).getTime() < cutoff) continue;
    const title = rawTitle.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    const { genres, gameTag } = detectGenreAndGame(title);
    results.push({
      id: videoId,
      title,
      channel: channelName,
      channelId,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      genres,
      gameTag: gameTag || undefined,
      publishedAt: published,
    });
  }
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(channelId, channelName) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
      const videos = parseRSS(xml, channelName, channelId);
      console.log(`  [${attempt}/${MAX_RETRIES}] ${channelName}: ${videos.length}개 영상`);
      return videos;
    } catch (e) {
      console.log(`  [${attempt}/${MAX_RETRIES}] ${channelName} 실패: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  console.log(`  ${channelName}: ${MAX_RETRIES}회 시도 후 포기`);
  return [];
}

async function main() {
  const dataDir = path.resolve(__dirname, "../data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const allVideos = [];
  const channelMeta = {};

  for (const ch of CHANNELS) {
    console.log(`\n>> ${ch.name} (${ch.id})`);
    const videos = await fetchWithRetry(ch.id, ch.name);
    allVideos.push(...videos);
    channelMeta[ch.id] = { name: ch.name };
    await sleep(1000);
  }

  allVideos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const output = {
    generatedAt: new Date().toISOString(),
    channels: channelMeta,
    videos: allVideos,
  };

  const outPath = path.join(dataDir, "video-recommend.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`\nDone! ${allVideos.length}개 영상 -> ${outPath}`);

  if (allVideos.length === 0) {
    console.error("ERROR: 영상을 하나도 수집하지 못했습니다.");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
