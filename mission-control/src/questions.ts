import { pendingQuestion } from './prompt';
import type { Run, Todo } from './types';

export type WorkQuestion = {
  runId: string;
  todoId: string;
  title: string;
  question: string;
  text: string;
  recommendation: Todo['recommendation'];
  options: { id: string; label: string }[];
  positions: { agent: string; optionId: string | undefined; summary: string }[];
  tradeoffs: string[];
  caveats: string[];
  conversation: NonNullable<Todo['conversation']>;
};

export function questionsOf(run: Run): WorkQuestion[] {
  return run.todos.flatMap((todo) => {
    const text = pendingQuestion(todo);
    if (text === null) return [];
    return [
      {
        runId: run.runId,
        todoId: todo.id,
        title: todo.title,
        question: todo.question,
        text,
        recommendation: todo.recommendation,
        options: todo.options.map((option) => ({ id: option.id, label: option.label })),
        positions: todo.positions.map((position) => ({
          agent: position.agent,
          optionId: position.optionId,
          summary: position.summary,
        })),
        tradeoffs: todo.tradeoffs,
        caveats: todo.caveats,
        conversation: todo.conversation ?? [],
      },
    ];
  });
}
