import { describe, expect, it } from 'vitest';
import { patrolSessionLabel } from './useScheduledPatrols';

describe('patrolSessionLabel', () => {
  it('does not use schedule names as patrol names', () => {
    expect(patrolSessionLabel({ patrol_schedules: { name: 'Houseroomschedule' } } as any)).toBe('Patrol session');
  });

  it('uses template or route names for the patrol label', () => {
    expect(patrolSessionLabel({ patrol_templates: { name: 'Night Patrol' }, patrol_routes: { name: 'Warehouse Route' }, patrol_schedules: { name: 'Night Schedule' } } as any)).toBe('Night Patrol');
    expect(patrolSessionLabel({ patrol_routes: { name: 'Warehouse Route' }, patrol_schedules: { name: 'Night Schedule' } } as any)).toBe('Warehouse Route');
  });
});
