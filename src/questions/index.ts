/**
 * The question registry: every question type lectio can ask, by name. The contract's
 * question table is generated from this list.
 */
import {matching, ordering} from './arrange.ts';
import {multipleChoice, multiSelect} from './choices.ts';
import {freeResponse} from './freeResponse.ts';
import {cloze, numeric, shortText} from './text.ts';
import type {QuestionType} from './types.ts';
import {widgetQuestion} from './widget.ts';

export const QUESTION_TYPES: ReadonlyArray<QuestionType<any, any>> = [multipleChoice, multiSelect, numeric, shortText, cloze, ordering, matching, freeResponse, widgetQuestion];

export const PLANNED_QUESTION_TYPES: Readonly<Record<string, string>> = {};

export function questionType(type: string): QuestionType<any, any> | undefined {
  return QUESTION_TYPES.find(t => t.type === type);
}

export const questionTypeNames = () => QUESTION_TYPES.map(t => t.type);
