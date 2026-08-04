import { getState, subscribe } from "@/lib/pipeline/store";
import type { RunState } from "@/lib/pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Steps fire far faster than anyone can read, so coalesce them into frames. */
const FRAME_MS = 250;
const HEARTBEAT_MS = 15_000;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const initial = getState(id);
      if (!initial) {
        controller.enqueue(encoder.encode(`event: missing\ndata: {}\n\n`));
        controller.close();
        return;
      }

      let closed = false;
      let pending: RunState | null = null;
      let frameTimer: NodeJS.Timeout | null = null;

      const write = (state: RunState) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
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
        }
      };

      write(initial);

      const unsubscribe = subscribe(id, (state) => {
        pending = state;
        // A terminal state must never sit in the buffer waiting for a tick.
        if (state.status !== "running") {
          if (frameTimer) clearTimeout(frameTimer);
          flush();
          return;
        }
        frameTimer ??= setTimeout(flush, FRAME_MS);
      });

      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            closed = true;
          }
        }
      }, HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        if (frameTimer) clearTimeout(frameTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      };

      request.signal.addEventListener("abort", close);
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
