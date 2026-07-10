/**
 * spike/PuckRenderStatic.tsx — THROWAWAY (Phase 0 spike; deleted before Phase 1 merges).
 *
 * React wrapper around Puck's server-safe <Render> entry (`@puckeditor/core/rsc` — Astro does not
 * apply the `react-server` export condition, so the bare package would resolve to the full editor
 * bundle). Rendered by an .astro page WITHOUT a client: directive → static HTML only.
 */

import { Render } from "@puckeditor/core/rsc"
import { spikeConfig, spikeData } from "./spike-config"

export default function PuckRenderStatic() {
    return <Render config={spikeConfig} data={spikeData} />
}
