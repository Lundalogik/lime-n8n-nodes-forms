/**
 * Shape of every unsuccessful Lime Forms API response.
 *
 * Lime Forms builds these with the shared `ApiResponse::error()` helper, which
 * always nests the payload one level below the envelope: the resource lives at
 * `error.data`, never at the top level.
 *
 * @see https://github.com/Lundalogik/lime-forms/blob/2.x/app/Helpers/ApiResponse.php
 */
export type ApiErrorResponse<T> = {
	success: false;
	error: {
		/** HTTP status text, e.g. `Conflict` for a 409. */
		code: string;
		message: string;
		data: T;
	};
};
