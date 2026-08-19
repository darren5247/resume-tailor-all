import { getState, loadPersistedRun, subscribe } from "@/lib/pipeline/store";
import type { RunState } from "@/lib/pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 250;

/** Steps fire far faster than anyone can read, so coalesce them into frames. */
const FRAME_MS = 250;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 400;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let initial = getState(id) ?? (await loadPersistedRun(id));
        if (!initial) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          initial = getState(id) ?? (await loadPersistedRun(id));
        }
        if (!initial) {
          controller.enqueue(encoder.encode(`event: missing\ndata: {}\n\n`));
          controller.close();
          return;
        }

        let closed = false;
        let pending: RunState | null = null;
        let frameTimer: NodeJS.Timeout | null = null;
        let last = "";
        let unsubscribe: () => void = () => undefined;
        let poll: NodeJS.Timeout | null = null;
        let heartbeat: NodeJS.Timeout | null = null;

        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          if (poll) clearInterval(poll);
          if (frameTimer) clearTimeout(frameTimer);
          try {
            controller.close();
          } catch {
            // Already closed by the client disconnecting.
          }
        };

        const write = (state: RunState) => {
          if (closed) return;
          const encoded = JSON.stringify(state);
          if (encoded === last) return;
          last = encoded;
          try {
            controller.enqueue(encoder.encode(`data: ${encoded}\n\n`));
          } catch {
            closed = true;
          }
        };

        const flush = () => {
          frameTimer = null;
          if (pending) {
            const state = pending;
            pending = null;
            write(state);
            if (state.status !== "running") close();
          }
        };

        const onState = (state: RunState) => {
          pending = state;
          if (state.status !== "running") {
            if (frameTimer) clearTimeout(frameTimer);
            flush();
            return;
          }
          frameTimer ??= setTimeout(flush, FRAME_MS);
        };

        write(initial);
        if (initial.status !== "running") {
          controller.close();
          return;
        }

        unsubscribe = subscribe(id, onState);
        poll = setInterval(() => {
          void (async () => {
            if (closed) return;
            const next = getState(id) ?? (await loadPersistedRun(id));
            if (next) onState(next);
          })();
        }, POLL_MS);
        heartbeat = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              closed = true;
            }
          }
        }, HEARTBEAT_MS);

        request.signal.addEventListener("abort", close);
      } catch (error) {
        try {
          controller.error(error);
        } catch {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
