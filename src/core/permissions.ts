/**
 * What an actor may do follows from its role. `agent:builder` builds lectio,
 * `agent:examiner` writes the checkups, and every other agent teaches; the learner is
 * `you`. Each route names the roles that may call it, and the router refuses everyone
 * else (src/server/api.ts).
 */
import {BUILDER_ACTOR, EXAMINER_ACTOR, isAgent, type Actor} from './types.ts';

export type Role = 'learner' | 'tutor' | 'builder' | 'examiner';

export function roleOf(actor: Actor): Role {
  if (actor === BUILDER_ACTOR) return 'builder';
  if (actor === EXAMINER_ACTOR) return 'examiner';
  return isAgent(actor) ? 'tutor' : 'learner';
}

/** Who may read a route that doesn't say: everyone but the examiner, who reads only its own. */
export const DEFAULT_READERS: readonly Role[] = ['learner', 'tutor', 'builder'];

/** Whether a role may see checkups (M12): the learner and the examiner. The tutor and the builder never do. */
export const seesExams = (role: Role): boolean => role === 'learner' || role === 'examiner';

const WHOSE: Record<Role, string> = {learner: "the learner's", tutor: "the tutor's", builder: "the builder's", examiner: "the examiner's"};

/** "the learner's", "the learner's or the tutor's": whose a refused action is. */
export function whose(roles: readonly Role[]): string {
  return roles.map(r => WHOSE[r]).join(' or ');
}
