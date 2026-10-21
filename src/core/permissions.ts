/**
 * What an actor may do follows from its role. `agent:builder` builds lectio; every other
 * agent teaches; the learner is `you`. Each route names the roles that may call it, and
 * the router refuses everyone else (src/server/api.ts).
 *
 * Protected (§11): an agent can't widen its own permissions without the learner's
 * explicit acknowledgement.
 */
import {BUILDER_ACTOR, isAgent, type Actor} from './types.ts';

export type Role = 'learner' | 'tutor' | 'builder';

export function roleOf(actor: Actor): Role {
  if (actor === BUILDER_ACTOR) return 'builder';
  return isAgent(actor) ? 'tutor' : 'learner';
}

const WHOSE: Record<Role, string> = {learner: "the learner's", tutor: "the tutor's", builder: "the builder's"};

/** "the learner's", "the learner's or the tutor's": whose a refused action is. */
export function whose(roles: readonly Role[]): string {
  return roles.map(r => WHOSE[r]).join(' or ');
}
