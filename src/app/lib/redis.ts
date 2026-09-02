import { Redis } from "@upstash/redis"
import config from "../config";

export const redisClient = new Redis({
	url: config.redis_url,
	token: config.redis_token
});

await redisClient.set('key', 'value');
let data = await redisClient.get('key');
console.log(data)