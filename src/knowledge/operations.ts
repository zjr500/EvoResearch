import type Database from 'better-sqlite3';
import {OperationService} from '../infrastructure/operations.js';
/** Compatibility facade: legacy routes and operation IDs keep their existing shape. */
export class Operations extends OperationService {
 constructor(db:Database.Database){super(db,'knowledge');this.recoverInterrupted();}
}
