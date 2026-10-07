import { Client, Receiver } from "@upstash/qstash";
import config from "../config";

export const qstashClient = new Client({
	baseUrl: config.qstash_url,
	token: config.qstash_token,
});

export const qstashReceiver = new Receiver({
	currentSigningKey: config.qstash_current_signing_key,
	nextSigningKey: config.qstash_next_signing_key,
});

export type QStashDelay = number | `${bigint}d` | `${bigint}h` | `${bigint}m` | `${bigint}s`;

export interface PublishTaskOptions {
	url: string;
	body: Record<string, unknown>;
	delay?: QStashDelay;
	retries?: number;
	headers?: Record<string, string>;
}

export const publishTask = async (options: PublishTaskOptions) => {
	return await qstashClient.publishJSON({
		url: options.url,
		body: options.body,
		delay: options.delay,
		retries: options.retries,
		headers: options.headers,
	});
};
