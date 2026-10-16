import { Value } from "./value";

export default function Page() {
  // Server-only, read at render. The repro can vary it each session (SERVER_VARY=1).
  return (
    <>
      <p>SERVER_VALUE: {process.env.SERVER_VALUE}</p>
      <Value />
    </>
  );
}
