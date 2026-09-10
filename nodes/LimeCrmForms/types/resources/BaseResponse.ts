export type BaseResponse<T = null> = {
	success: boolean;
	data: T;
};
