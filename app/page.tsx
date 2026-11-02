import { LOGO } from '@/lib/brand'

export default function Home() {
  return (
    <main className="landing">
      <header>
        <a href="https://cascadeonlinedesign.com" className="landing-logo">
          <img src={LOGO} alt="Cascade Online Design" />
        </a>
      </header>

      <section className="landing-body">
        <p className="landing-eyebrow">Client review portal</p>
        <h1>
          Lost your <span>review link?</span>
        </h1>
        <p className="landing-copy">
          Every website preview has its own private link. Open the full link from the email we sent
          you, or get in touch and we&apos;ll send it again.
        </p>
        <div className="landing-actions">
          <a
            href="mailto:info@cascadeonlinedesign.com?subject=Review%20link%20request"
            className="landing-cta"
          >
            Email us for a new link
          </a>
          <a href="tel:+15417406878" className="landing-phone">
            541.740.6878
          </a>
        </div>
      </section>

      <div className="landing-ridge" aria-hidden="true">
        <div />
        <div />
        <div />
      </div>
      <footer>© 2026 Cascade Online Design · Albany, Oregon</footer>
    </main>
  )
}
