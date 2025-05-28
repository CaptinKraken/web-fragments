import type { FragmentConfig, FragmentGateway } from '../../fragment-gateway';
import { asReadableStream } from '../../stream-utilities';

const fragmentHostInitialization = ({
	fragmentId,
	content,
	classNames,
}: {
	fragmentId: string;
	content: string | ReadableStream | null;
	classNames: string;
}) => asReadableStream`
<fragment-host class="${classNames}" fragment-id="${fragmentId}" data-piercing="true">
  <template shadowrootmode="open">${content ?? ''}</template>
</fragment-host>`;

export type FragmentMiddlewareOptions = {
	additionalHeaders?: HeadersInit;
	mode?: 'production' | 'development';
};

export function getMiddleware(
	gateway: FragmentGateway,
	options: FragmentMiddlewareOptions = {},
): PagesFunction<unknown> {
	const { additionalHeaders = {}, mode = 'development' } = options;

	return async ({ request, next }) => {
		const matchedFragment = gateway.matchRequestToFragment(request);

		if (matchedFragment) {
			// If this request was initiated by an iframe (via reframed),
			// return a stub document.
			//
			// Reframed has to set the iframe's `src` to the fragment URL to have
			// its `document.location` reflect the correct value
			// (and also avoid same-origin policy restrictions).
			// However, we don't want the iframe's document to actually contain the
			// fragment's content; we're only using it as an isolated execution context.
			// Returning a stub document here is our workaround to that problem.
			if (request.headers.get('sec-fetch-dest') === 'iframe') {
				return new Response('<!doctype html><title>');
			}

			const fragmentResponse = fetchFragment(request, matchedFragment);

			// If this is a document request, we need to fetch the host application
			// and if we get a successful HTML response, we need to embed the fragment inside it.
			if (request.headers.get('sec-fetch-dest') === 'document') {
				const hostResponse = await next();
				const isHTMLResponse = !!hostResponse.headers.get('content-type')?.startsWith('text/html');

				if (hostResponse.ok && isHTMLResponse) {
					return fragmentResponse
						.then(rejectErrorResponses)
						.catch(handleFetchErrors(request, matchedFragment))
						.then(prepareFragmentForReframing)
						.then(embedFragmentIntoHost(hostResponse, matchedFragment))
						.then(attachForwardedHeaders(fragmentResponse, matchedFragment))
						.catch(renderErrorResponse);
				}
			}

			// Otherwise, just return the fragment response.
			return fragmentResponse;
		} else {
			return next();
		}
	};

	async function fetchFragment(request: Request, fragmentConfig: FragmentConfig) {
		const { endpoint } = fragmentConfig;
		const requestUrl = new URL(request.url);
		const fragmentEndpoint = new URL(`${requestUrl.pathname}${requestUrl.search}`, endpoint);

		const fragmentReq = new Request(fragmentEndpoint, request);

		// attach additionalHeaders to fragment request
		for (const [name, value] of new Headers(additionalHeaders).entries()) {
			fragmentReq.headers.set(name, value);
		}

		// Note: we don't want to forward the sec-fetch-dest since we usually need
		//       custom logic so that we avoid returning full htmls if the header is
		//       not set to 'document'
		fragmentReq.headers.set('sec-fetch-dest', 'empty');

		// Add a header for signalling embedded mode
		fragmentReq.headers.set('x-fragment-mode', 'embedded');

		if (mode === 'development') {
			// brotli is not currently supported during local development (with `wrangler (pages) dev`)
			// so we set the accept-encoding to gzip to avoid problems with it
			fragmentReq.headers.set('Accept-Encoding', 'gzip');
		}

		return fetch(fragmentReq);
	}

	function rejectErrorResponses(response: Response) {
		if (response.ok) return response;
		throw response;
	}

	function handleFetchErrors(fragmentRequest: Request, fragmentConfig: FragmentConfig) {
		return async (fragmentResponseOrError: unknown) => {
			const { fragmentId, endpoint, onSsrFetchError } = fragmentConfig;

			let errorResponse: Response;
			let upstreamStatus = 500;

			if (fragmentResponseOrError instanceof Response) {
				upstreamStatus = fragmentResponseOrError.status;
			}

			if (onSsrFetchError) {
				try {
					const result = await onSsrFetchError(fragmentRequest, fragmentResponseOrError);
					if (result && result.response && result.overrideResponse) {
						// Consumer wants to override the response completely
						throw result.response; // Caught by renderErrorResponse
					} else if (result && result.response) {
						// Consumer provided a response but doesn't want to fully override.
						// This case is a bit ambiguous with the current SSRFetchErrorResponse interface.
						// For now, we'll assume if overrideResponse is not true, we proceed to default error.
						// This could be a point of future refinement if consumers need to partially override.
						// Proceed to default JSON error response.
					}
					// If onSsrFetchError ran without throwing or returning an override,
					// it means it might have just logged the error. Proceed to default JSON error.
				} catch (e) {
					if (e instanceof Response) {
						// Consumer's onSsrFetchError threw a Response, treat as override
						throw e; // Caught by renderErrorResponse
					}
					// Consumer's onSsrFetchError threw some other error. Log it and proceed to default JSON.
					console.error(`Error in onSsrFetchError for fragment ${fragmentId}:`, e);
				}
			}

			// Default JSON error response
			errorResponse = new Response(
				JSON.stringify({
					__isFragmentGatewayError__: true,
					message: `SSR fetch failed for fragment ${fragmentId}. Upstream endpoint: ${endpoint}`,
					status: upstreamStatus,
				}),
				{
					status: upstreamStatus, // Use upstream status if available, otherwise 500
					headers: { 'Content-Type': 'application/json' },
				},
			);

			// The original logic was to return the response if not overriding.
			// However, the goal is to *throw* if we are not using the consumer's *overridden* response,
			// so that it's caught by renderErrorResponse and becomes the actual response sent to the client.
			// If onSsrFetchError was called and didn't result in an early throw (override),
			// we now throw our new standardized JSON error.
			throw errorResponse;
		};
	}

	function renderErrorResponse(err: unknown) {
		if (err instanceof Response) {
			// Ensure the response status is an error status if it's our custom JSON error
			if (err.headers.get('content-type')?.includes('application/json')) {
				try {
					const body = JSON.parse(err.bodyUsed ? '' : (err.clone() as any)._bodyInit); // Quick check, might need robust clone and read
					if (body.__isFragmentGatewayError__ && err.status < 400) {
						// This shouldn't happen if constructed correctly, but as a safeguard
						return new Response(err.body, { ...err, status: body.status || 500 });
					}
				} catch (e) {
					// If parsing fails, it's not our JSON error, or body is not JSON.
				}
			}
			return err;
		}
		// Fallback for non-Response errors
		console.error('Unhandled error in gateway:', err);
		return new Response(
			JSON.stringify({
				__isFragmentGatewayError__: true,
				message: 'An unexpected error occurred in the fragment gateway.',
				status: 500,
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}

	// When embedding an SSRed fragment, we need to make
	// any included scripts inert so they only get executed by Reframed.
	function prepareFragmentForReframing(fragmentResponse: Response) {
		return new HTMLRewriter()
			.on('script', {
				element(element) {
					const scriptType = element.getAttribute('type');
					if (scriptType) {
						element.setAttribute('data-script-type', scriptType);
					}
					element.setAttribute('type', 'inert');
				},
			})
			.transform(fragmentResponse);
	}

	function embedFragmentIntoHost(hostResponse: Response, fragmentConfig: FragmentConfig) {
		return (fragmentResponse: Response) => {
			const { fragmentId, prePiercingClassNames } = fragmentConfig;

			return new HTMLRewriter()
				.on('head', {
					element(element) {
						element.append(gateway.prePiercingStyles, { html: true });
					},
				})
				.on('body', {
					async element(element) {
						element.append(
							fragmentHostInitialization({
								fragmentId,
								content: fragmentResponse.body,
								classNames: prePiercingClassNames.join(' '),
							}),
							{ html: true },
						);
					},
				})
				.transform(hostResponse);
		};
	}

	function attachForwardedHeaders(fragmentResponse: Promise<Response>, fragmentConfig: FragmentConfig) {
		return async (response: Response) => {
			const fragmentHeaders = (await fragmentResponse).headers;
			const { forwardFragmentHeaders = [] } = fragmentConfig;

			for (const header of forwardFragmentHeaders) {
				response.headers.append(header, fragmentHeaders.get(header) || '');
			}

			return response;
		};
	}
}
