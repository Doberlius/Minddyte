'use client'

import { CardTour, Point, type Slide } from '@/components/ui/CardTour'
import { ShapeComparison } from '@/components/ui/GraphShapes'

/**
 * The first-run guide.
 *
 * Written for someone who has never seen the app: short sentences, everyday
 * words, one idea per card. Anything technical (trigrams, precision numbers,
 * how the model is reached) belongs in the README, not here.
 *
 * Nothing here claims a feature that is not built: Forgetting is not built
 * yet and there is no web search, so neither appears.
 */

const SLIDES: Slide[] = [
  {
    title: 'Your chats remember each other',
    body: (
      <>
        <p>Chat the way you normally would.</p>
        <p>
          Minddyte notices the topics you mention, like <code>PostgreSQL</code> or{' '}
          <code>Kafka</code>, and links chats that talk about the same topic. No folders, no
          tagging.
        </p>
      </>
    ),
  },
  {
    title: 'How chats get linked',
    body: (
      <>
        <ShapeComparison />
        <p>Two chats are linked when they mention the same topic.</p>
        <ul className="tour-points">
          <Point>You can always see which words made the link.</Point>
          <Point>The same messages always make the same links.</Point>
        </ul>
      </>
    ),
  },
  {
    title: 'It uses your past chats',
    body: (
      <>
        <p>
          When you ask something, Minddyte looks through your other chats and hands the AI the
          few sentences that fit your question best.
        </p>
        <p>Everything you say is kept, word for word. Nothing is rewritten.</p>
      </>
    ),
  },
  {
    title: 'Choose what it can see',
    body: (
      <>
        <ul className="tour-points">
          <Point>
            <code>@</code> adds another chat to this one.
          </Point>
          <Point>
            <code>/mode explore</code> also looks in related chats. This is the default.
          </Point>
          <Point>
            <code>/mode focus</code> only uses the chats you added with <code>@</code>.
          </Point>
          <Point>
            The <strong>model</strong> button picks which AI replies.
          </Point>
        </ul>
        <p style={{ marginTop: 13 }}>
          Type <code>/</code> or <code>@</code> in the message box to see the options.
        </p>
      </>
    ),
  },
  {
    title: 'The Brain view',
    body: (
      <>
        <p>
          Boxes are chats. Pills are topics.
        </p>
        <p>
          A purple pill with a number is a topic shared by that many chats. You can drag
          anything around.
        </p>
      </>
    ),
  },
  {
    title: 'The Archive view',
    body: (
      <p>
        A list of all your chats and the topics in each one, so you can see what Minddyte
        knows about.
      </p>
    ),
  },
  {
    title: 'Your chat list',
    body: (
      <>
        <p>
          Right-click a chat in the sidebar, or press <strong>···</strong>, to rename or delete
          it. Deleting can&rsquo;t be undone.
        </p>
        <p style={{ marginTop: 13 }}>
          Open this guide again anytime with <strong>?</strong> in the sidebar.
        </p>
      </>
    ),
  },
]

export function AppTour({ onClose }: { onClose: () => void }) {
  return <CardTour slides={SLIDES} finalLabel="Start chatting" onClose={onClose} />
}
