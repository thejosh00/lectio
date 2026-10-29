/**
 * How a block reports what the learner did with it beyond reading it — a step taken, the end
 * reached — into the lesson's activity batch (`useActivity` in Lesson.tsx). Outside a lesson
 * (a preview, a test) it goes nowhere.
 */
import {createContext, useContext} from 'react';

export type ReportActivity = (blockId: string, what: {interactions?: number; completed?: boolean}) => void;

export const ActivityContext = createContext<ReportActivity>(() => undefined);

export const useReportActivity = () => useContext(ActivityContext);
