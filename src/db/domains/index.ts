/**
 * Domain repository split entry.
 *
 * Current production path still uses the monolithic Repositories class.
 * New domain-focused modules should be added under src/db/domains/* and
 * gradually composed here so ChiefOfStaff and workers can depend on smaller surfaces.
 */
export { Repositories } from '../repositories.js';
export { AppOSRepository } from '../apposRepository.js';
