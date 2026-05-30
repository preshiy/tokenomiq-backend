import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// FETCH COINGECKO DATA
// ─────────────────────────────────────────────
async function fetchCoinGeckoData(tokenQuery) {
  try {
    const searchRes = await axios.get(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(tokenQuery)}`
    );
    if (!searchRes.data.coins?.length) return null;

    const coinId = searchRes.data.coins[0].id;
    const coinRes = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
    );

    const d = coinRes.data;
    return {
      name: d.name,
      symbol: d.symbol?.toUpperCase(),
      categories: d.categories,
      description: d.description?.en?.slice(0, 500),
      market_data: {
        current_price_usd: d.market_data?.current_price?.usd,
        market_cap_usd: d.market_data?.market_cap?.usd,
        fully_diluted_valuation_usd: d.market_data?.fully_diluted_valuation?.usd,
        total_volume_24h_usd: d.market_data?.total_volume?.usd,
        circulating_supply: d.market_data?.circulating_supply,
        total_supply: d.market_data?.total_supply,
        max_supply: d.market_data?.max_supply,
      },
    };
  } catch (err) {
    return null;
  }
}

// ─────────────────────────────────────────────
// FETCH DEFILLAMA DATA
// ─────────────────────────────────────────────
async function fetchDeFiLlamaData(tokenQuery) {
  try {
    const res = await axios.get("https://api.llama.fi/protocols");
    const match = res.data.find(
      (p) =>
        p.name.toLowerCase().includes(tokenQuery.toLowerCase()) ||
        p.symbol?.toLowerCase() === tokenQuery.toLowerCase()
    );
    if (!match) return null;
    return {
      name: match.name,
      tvl: match.tvl,
      chain: match.chain,
      category: match.category,
      mcap_to_tvl:
        match.mcap && match.tvl
          ? parseFloat((match.mcap / match.tvl).toFixed(2))
          : null,
    };
  } catch (err) {
    return null;
  }
}

// ─────────────────────────────────────────────
// AI ANALYSIS WITH GROQ
// ─────────────────────────────────────────────
async function analyzeWithAI(tokenQuery, coinGeckoData, defiData, whitepaperText) {
  const context = `
TOKEN: ${tokenQuery}
COINGECKO: ${JSON.stringify(coinGeckoData, null, 2)}
DEFILLAMA: ${JSON.stringify(defiData, null, 2)}
WHITEPAPER/DOCS: ${whitepaperText || "Not provided"}
`;

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content: `You are TokenomIQ, a professional crypto tokenomics analyst. Analyze the provided token data and produce a structured report with these sections:

## 🪙 TOKEN OVERVIEW
## ⚙️ SUPPLY MECHANICS (Score: X/10)
## 🏦 DISTRIBUTION ANALYSIS (Score: X/10)
## 💧 LIQUIDITY & MARKET METRICS (Score: X/10)
## 🐋 CENTRALIZATION RISK (Score: X/10)
## ⚠️ RED FLAGS
## ✅ GREEN FLAGS
${whitepaperText ? "## 🔍 WHITEPAPER VS ON-CHAIN CROSS-REFERENCE\n(Compare claims in the whitepaper against on-chain data. Flag every contradiction.)" : ""}
## 🎯 OVERALL SCORE: XX/100
**Final Verdict: STRONG / MODERATE / WEAK / HIGH RISK / DO NOT INVEST**

Be objective and data-driven.`,
      },
      {
        role: "user",
        content: `Analyze tokenomics:\n\n${context}`,
      },
    ],
  });

  return response.choices[0].message.content;
}

// ─────────────────────────────────────────────
// MAIN ROUTE
// ─────────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { tokenQuery, whitepaperText } = req.body;

  if (!tokenQuery) {
    return res.status(400).json({ error: "Token name or symbol is required" });
  }

  try {
    const [coinGeckoData, defiData] = await Promise.all([
      fetchCoinGeckoData(tokenQuery),
      fetchDeFiLlamaData(tokenQuery),
    ]);

    if (!coinGeckoData && !defiData) {
      return res
        .status(404)
        .json({ error: `Could not find data for "${tokenQuery}"` });
    }

    const report = await analyzeWithAI(
      tokenQuery,
      coinGeckoData,
      defiData,
      whitepaperText
    );

    res.json({
      success: true,
      token: coinGeckoData?.name || tokenQuery,
      symbol: coinGeckoData?.symbol,
      report,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`TokenomIQ backend running on port ${PORT}`)
);node server.js