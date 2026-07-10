/**
 * spike/spike-config.tsx — THROWAWAY (Phase 0 spike; deleted before Phase 1 merges).
 *
 * Minimal server-safe Puck config exercising the primitives Phase 1 depends on: a Section with a
 * `slot` field (the modern replacement for DropZone), a Heading, and a plain-text Paragraph. Render
 * functions are pure (no hooks, no browser APIs) per the catalog purity rule, and consume `--dtk-*`
 * custom properties for spike (c).
 */

import type { Config, Data } from "@puckeditor/core"

export const spikeConfig: Config = {
    components: {
        Section: {
            fields: {
                content: { type: "slot" }
            },
            render: ({ content: Content }) => (
                <section
                    style={{
                        background: "var(--dtk-color-band-primary, transparent)",
                        padding: "var(--dtk-space-section-y, 0) 1rem"
                    }}
                >
                    <Content />
                </section>
            )
        },
        Heading: {
            fields: {
                text: { type: "text" },
                level: {
                    type: "select",
                    options: [
                        { label: "H1", value: "h1" },
                        { label: "H2", value: "h2" }
                    ]
                }
            },
            defaultProps: { text: "Heading", level: "h2" },
            render: ({ text, level }) => {
                const Tag = level === "h1" ? "h1" : "h2"
                return <Tag style={{ fontFamily: "var(--dtk-type-display-family, serif)" }}>{text}</Tag>
            }
        },
        Paragraph: {
            fields: {
                text: { type: "textarea" }
            },
            defaultProps: { text: "Paragraph text" },
            render: ({ text }) => <p style={{ fontFamily: "var(--dtk-type-body-family, sans-serif)" }}>{text}</p>
        }
    }
}

/** Hardcoded document exercising a slot (Section containing Heading + Paragraph) plus a root-level sibling. */
export const spikeData: Data = {
    root: { props: {} },
    content: [
        {
            type: "Section",
            props: {
                id: "section-1",
                content: [
                    { type: "Heading", props: { id: "heading-1", text: "Spike: static render", level: "h1" } },
                    { type: "Paragraph", props: { id: "para-1", text: "Rendered inside a slot with zero client JS." } }
                ]
            }
        },
        {
            type: "Paragraph",
            props: { id: "para-2", text: "Root-level sibling outside the slot." }
        }
    ]
}
