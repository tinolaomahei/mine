import { useInView } from '../lib/useInView'

// A timing diagram, not a benchmark: it shows the order things happen in.
// No numbers on purpose; we haven't measured the real thing yet.
export function Intent() {
  const [ref, inView] = useInView<HTMLDivElement>(0.4)
  const bars = Array.from({ length: 46 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 0.75)

  return (
    <section className="section intent on-ink" id="fast" aria-labelledby="intent-title">
      <div className="intent-head">
        <h2 id="intent-title" className="h2">
          It knows what you meant before you finish saying it.
        </h2>
        <p className="body">
          A small, fast model reads your request first and works out the intent: which tool, which action, which
          thing. The work starts there. The larger model follows with the detail, so the screen is already moving by
          the time you stop talking.
        </p>
      </div>

      <div ref={ref} className={`timing ${inView ? 'is-in' : ''}`}>
        <div className="lane">
          <span className="lane-label mono">you</span>
          <div className="lane-track wave" aria-hidden="true">
            {bars.map((h, i) => (
              <i key={i} style={{ transform: `scaleY(${h})`, transitionDelay: `${i * 18}ms` }} />
            ))}
          </div>
        </div>
        <p className="quote">“File a bug for the export timeout Priya mentioned in Slack.”</p>

        <div className="lane">
          <span className="lane-label mono">intent</span>
          <div className="lane-track">
            <span className="block block-intent">
              <span className="mono">jira · create issue · bug</span>
            </span>
          </div>
        </div>

        <div className="lane">
          <span className="lane-label mono">work</span>
          <div className="lane-track">
            <span className="block block-work b1">
              <span className="mono">find thread</span>
            </span>
            <span className="block block-work b2">
              <span className="mono">draft</span>
            </span>
            <span className="block block-work b3">
              <span className="mono">file + link</span>
            </span>
          </div>
        </div>

        <div className="timing-axis mono" aria-hidden="true">
          <span>speaking</span>
          <span>done</span>
        </div>
      </div>
    </section>
  )
}
