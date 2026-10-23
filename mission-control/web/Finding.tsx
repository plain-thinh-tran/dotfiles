import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Agent, Run, RunMode, RunPr, Todo } from '../src/types';
import { anchorMatchesPath, parseAnchor, prLineUrl } from './anchor';
import { Consensus } from './Consensus';
import { Conversation } from './Conversation';
import { Diff } from './Diff';
import { History } from './History';
import { ModeTag } from './ModeTag';

type FindingProps = {
  mode: RunMode;
  pr: RunPr | null;
  run: Run;
  todo: Todo;
  agents: Agent[];
  instantAsk: boolean;
  dead: boolean;
  draft: string;
  busy: boolean;
  onDraft: (text: string) => void;
  onGotIt: () => void;
  onDrop: () => void;
  onPost: () => void;
  onReopen: () => void;
  onAsk: (text: string) => void;
  onRetry: () => void;
  onCopy: (text: string) => void;
};

function isUrl(text: string | null): text is string {
  return text !== null && /^https?:\/\//.test(text);
}

function usePrLineUrl(pr: RunPr | null, todo: Todo): string | null {
  const anchor = parseAnchor(todo.evidence[0]?.ref);
  const path = anchor === null ? undefined : todo.diffs?.find((diff) => anchorMatchesPath(anchor.path, diff.path))?.path;
  const line = anchor?.line;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (pr === null || path === undefined || line === undefined) return;
    let current = true;
    void prLineUrl(pr.url, path, line).then((next) => {
      if (current) setUrl(next);
    });
    return () => {
      current = false;
    };
  }, [pr, path, line]);
  return url;
}

function FindingBar(props: FindingProps) {
  const { todo } = props;
  const anchor = parseAnchor(todo.evidence[0]?.ref);
  const lineUrl = usePrLineUrl(props.pr, todo);
  const editable = todo.state === 'open' || todo.state === 'answered';
  let content;
  if (editable && props.mode === 'self-check') {
    content = (
      <div className="answer-actions">
        <span className="answer-status">Fix list, no comment to post</span>
        <span className="answer-actions-end">
          <button className="btn" disabled={props.busy} onClick={props.onGotIt}>
            Got it
          </button>
          <button className="btn" disabled={props.busy} onClick={props.onDrop}>
            Drop
          </button>
        </span>
      </div>
    );
  } else if (editable) {
    content = (
      <>
        {anchor !== null ? (
          <div className="comment-anchor muted mono">
            {`Comment goes on ${anchor.path}:${anchor.line}`}
            {lineUrl !== null ? (
              <a className="finding-link" href={lineUrl} target="_blank" rel="noreferrer">
                Open line in PR
              </a>
            ) : null}
          </div>
        ) : null}
        <textarea
          value={props.draft}
          placeholder="Draft the review comment you would leave on the PR"
          rows={3}
          onChange={(event) => props.onDraft(event.target.value)}
        />
        <div className="answer-actions">
          {todo.state === 'answered' ? <span className="answer-status">Comment queued, sent with Submit</span> : null}
          <span className="answer-actions-end">
            {todo.state === 'answered' ? (
              <button className="link" onClick={props.onReopen}>
                Reopen
              </button>
            ) : null}
            <button className="btn" disabled={props.busy} onClick={props.onGotIt}>
              Got it
            </button>
            <button className="btn" disabled={props.busy} onClick={props.onDrop}>
              Drop
            </button>
            <button className="btn btn-primary" disabled={props.busy || props.draft.trim() === ''} onClick={props.onPost}>
              {todo.state === 'answered' ? 'Update comment' : 'Post comment'}
            </button>
          </span>
        </div>
      </>
    );
  } else if (todo.state === 'understood' || todo.state === 'dropped') {
    content = (
      <div className="answer-actions">
        <span className="answer-status">{todo.state === 'understood' ? 'Understood' : 'Dropped'}</span>
        <button className="btn" onClick={props.onReopen}>
          Reopen
        </button>
      </div>
    );
  } else if (todo.state === 'commented') {
    content = (
      <div className="answer-actions">
        <span className="answer-status">Commented</span>
        {isUrl(todo.resolution) ? (
          <a className="finding-link" href={todo.resolution} target="_blank" rel="noreferrer">
            {todo.resolution}
          </a>
        ) : (
          <span className="muted">{todo.resolution}</span>
        )}
      </div>
    );
  } else {
    content = (
      <div className="answer-actions">
        <span className="answer-status">Comment sent to the agent</span>
        <span className="muted finding-comment">{todo.answer?.text}</span>
      </div>
    );
  }
  return (
    <footer className="answer-bar">
      <div className="answer-bar-inner">{content}</div>
    </footer>
  );
}

function Asking({ todo, onAsk }: { todo: Todo; onAsk: (text: string) => void }) {
  const [text, setText] = useState('');
  const asked = new Set((todo.conversation ?? []).filter((message) => message.from === 'thinh').map((message) => message.text));
  const suggestions = (todo.suggestedQuestions ?? []).filter((question) => !asked.has(question));
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (text.trim() === '') return;
    onAsk(text.trim());
    setText('');
  }
  return (
    <div className="finding-ask">
      {suggestions.length > 0 ? (
        <div className="suggestions">
          {suggestions.map((question) => (
            <button key={question} className="suggestion" onClick={() => onAsk(question)}>
              {question}
            </button>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit}>
        <input value={text} placeholder="Ask a follow-up question" onChange={(event) => setText(event.target.value)} />
        <button className="btn" type="submit" disabled={text.trim() === ''}>
          Ask
        </button>
      </form>
    </div>
  );
}

export function FindingPane(props: FindingProps) {
  const { run, todo, agents } = props;
  const conversation = todo.conversation ?? [];
  const anchor = parseAnchor(todo.evidence[0]?.ref);
  const evidenceRefs = [...new Set(todo.evidence.map((item) => item.ref))];
  const lineUrl = usePrLineUrl(props.pr, todo);
  return (
    <>
      <div className="detail-scroll">
        <article className="detail-inner">
          <header className="detail-head">
            <span className="detail-id mono">{todo.id}</span>
            <div className="detail-title">
              <h2>{todo.title}</h2>
              <ModeTag mode={props.mode} pr={props.pr} />
            </div>
            <div className="detail-sub">
              <span>{run.title}</span>
              <span className="chip skill">{run.skill}</span>
              {todo.severity !== undefined ? <span className="finding-severity">{todo.severity}</span> : null}
            </div>
          </header>
          {todo.question !== '' ? <p className="question">{todo.question}</p> : null}
          {todo.verification !== undefined && todo.verification !== '' ? (
            <p className="finding-verified">Verified: {todo.verification}</p>
          ) : null}
          {todo.evidence.length > 0 || todo.links.length > 0 ? (
            <div className="finding-refs">
              {evidenceRefs.map((ref) => (
                <button key={ref} className="ref mono" title="Copy reference" onClick={() => props.onCopy(ref)}>
                  {ref}
                </button>
              ))}
              {todo.links.map((link) => (
                <a key={link.url} className="finding-link" href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
              {lineUrl !== null && anchor !== null ? (
                <a className="finding-link" href={lineUrl} target="_blank" rel="noreferrer">
                  {`Line ${anchor.line} in PR`}
                </a>
              ) : null}
            </div>
          ) : null}
          {todo.diffs !== undefined && todo.diffs.length > 0 ? (
            <section>
              <h3>Change</h3>
              <div className="diffs">
                {todo.diffs.map((diff) => (
                  <Diff
                    key={diff.path}
                    path={diff.path}
                    patch={diff.patch}
                    focusLine={anchor !== null && anchorMatchesPath(anchor.path, diff.path) ? anchor.line : undefined}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {todo.positions.length > 0 ? (
            <section>
              <h3>Reviewers</h3>
              <Consensus key={todo.id} positions={todo.positions} alsoRaisedAs={todo.alsoRaisedAs ?? []} agents={agents} />
            </section>
          ) : null}
          <section>
            <h3>Questions</h3>
            {conversation.length > 0 ? <Conversation messages={conversation} agents={agents} instantAsk={props.instantAsk} dead={props.dead} onRetry={props.onRetry} /> : null}
            <Asking todo={todo} onAsk={props.onAsk} />
          </section>
          <section>
            <h3>History</h3>
            <History run={run} todo={todo} agents={agents} />
          </section>
        </article>
      </div>
      <FindingBar {...props} />
    </>
  );
}
