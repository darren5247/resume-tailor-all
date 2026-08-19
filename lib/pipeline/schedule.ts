import { after } from "next/server";

/** Keep pipeline work alive after the HTTP response. Locally the process stays up; on Vercel this is waitUntil. */
export function schedulePipeline(work: () => Promise<void>): void {
  const task = () =>
    work().catch((error) => {
      console.error("[resume-tailor] pipeline", error);
    });

  if (process.env.VERCEL) {
    after(task);
    return;
  }
  setImmediate(() => {
    void task();
  });
}
