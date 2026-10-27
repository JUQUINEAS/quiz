const { randomUUID } = require("node:crypto");

const LEADERBOARD_KEY = "circulatorio:leaderboard";
const MAX_SCORE = 240;

async function redisCommand(command) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        const error = new Error("O ranking ainda não foi configurado no Vercel.");
        error.statusCode = 503;
        throw error;
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(command)
    });

    const payload = await response.json();
    if (!response.ok || payload.error) {
        throw new Error("O serviço de ranking está indisponível.");
    }

    return payload.result;
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
        try {
            const result = await redisCommand([
                "ZREVRANGE",
                LEADERBOARD_KEY,
                "0",
                "9",
                "WITHSCORES"
            ]);
            const ranking = [];

            for (let index = 0; index < result.length; index += 2) {
                try {
                    const jogador = JSON.parse(result[index]);
                    ranking.push({
                        name: jogador.name,
                        score: Number(result[index + 1])
                    });
                } catch {
                    throw new Error("Há um registro inválido no ranking.");
                }
            }

            return res.status(200).json({ ranking });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                error: error.statusCode === 503
                    ? error.message
                    : "Não foi possível carregar o ranking."
            });
        }
    }

    if (req.method === "POST") {
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        const score = req.body?.score;

        if (!name || name.length > 24) {
            return res.status(400).json({
                error: "Informe um nome com até 24 caracteres."
            });
        }

        if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
            return res.status(400).json({ error: "A pontuação informada é inválida." });
        }

        try {
            const jogador = JSON.stringify({
                name,
                id: randomUUID()
            });
            await redisCommand([
                "ZADD",
                LEADERBOARD_KEY,
                String(score),
                jogador
            ]);
            await redisCommand([
                "ZREMRANGEBYRANK",
                LEADERBOARD_KEY,
                "0",
                "-11"
            ]);
            return res.status(201).json({ saved: true });
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                error: error.statusCode === 503
                    ? error.message
                    : "Não foi possível salvar a pontuação."
            });
        }
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Método não permitido." });
};
