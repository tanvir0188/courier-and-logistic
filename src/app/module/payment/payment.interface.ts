export interface ICreateCheckoutSessionPayload {
	shipmentId: string;
	successUrl?: string;
	cancelUrl?: string;
}

export interface IVerifySessionPayload {
	sessionId: string;
}
