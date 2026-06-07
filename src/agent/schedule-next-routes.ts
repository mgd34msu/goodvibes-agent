function routeArg(value: string): string {
  return JSON.stringify(value);
}

function routeLine(id: string, route: string): string {
  return `    ${id} ${route}`;
}

export function scheduleNextRouteLines(scheduleId: string, options: { readonly deleted?: boolean } = {}): readonly string[] {
  const id = scheduleId && scheduleId !== '(unknown)' ? scheduleId : '...';
  const query = id === '...' ? '' : ` query:${routeArg(id)}`;
  const scheduleIdArg = `scheduleId:${routeArg(id)}`;
  const lines = [
    '  nextRoutes',
    routeLine('listSchedules', `schedule action:"list"${query}`),
    routeLine('autonomyQueue', 'autonomy action:"item" queueItemId:"connected-schedules" includeParameters:true'),
  ];
  if (options.deleted) {
    lines.push(
      routeLine('createAutonomousSchedule', 'schedule action:"create" task:"..." successCriteria:"..." every:"..." confirm:true explicitUserRequest:"..."'),
      routeLine('createReminder', 'schedule action:"remind" message:"..." at:"..." confirm:true explicitUserRequest:"..."'),
    );
    return lines;
  }
  lines.push(
    routeLine('runNow', `schedule action:"run" ${scheduleIdArg} confirm:true explicitUserRequest:"..."`),
    routeLine('editSchedule', `schedule action:"edit" ${scheduleIdArg} confirm:true explicitUserRequest:"..."`),
    routeLine('pauseSchedule', `schedule action:"pause" ${scheduleIdArg} confirm:true explicitUserRequest:"..."`),
    routeLine('resumeSchedule', `schedule action:"resume" ${scheduleIdArg} confirm:true explicitUserRequest:"..."`),
    routeLine('deleteSchedule', `schedule action:"delete" ${scheduleIdArg} confirm:true explicitUserRequest:"..."`),
  );
  return lines;
}
