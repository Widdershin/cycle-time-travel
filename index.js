const {Rx, run} = require('@cycle/core');
const {h, makeDOMDriver} = require('@cycle/dom');

function log (label) {
  return (thing) => {
    console.log(label, thing);
    return thing;
  };
}

const drivers = {
  DOM: makeDOMDriver('.cycle')
};

function view (count$) {
  return count$
    .map((count) => (
      h('.widget', [
        h('span.count', `Count: ${count}`),
        h('button.increment', 'Increment')
      ])
    )
  );
}

function model (click$) {
  return click$
    .map(_ => 1)
    .scan((count, value) => count + value)
    .startWith(0);
}

function intent (DOM) {
  return DOM.get('.increment', 'click');
}

function getCurrentTime () {
  return new Date().getTime();
}

function calculateValuePosition (currentTime, streamValue) {
  const occurrenceTimeAgoInMs = currentTime - streamValue.timestamp;

  return (100 - (occurrenceTimeAgoInMs / 50));
}

function renderStreamValue (currentTime, streamValue) {
  const left = calculateValuePosition(currentTime, streamValue);

  if (left < -10) {
    return null;
  }

  return (
    h('.stream-value', {style: {left: left + '%'}}, JSON.stringify(streamValue.value))
  );
}

function renderStream (currentTime, streamValues) {
  return (
    h('.stream', [
      h('.stream-title', streamValues.label),
      ...streamValues.map(renderStreamValue.bind(null, currentTime))
    ])
  );
}

function getMousePosition (ev) {
  return {
    x: ev.clientX,
    y: ev.clientY
  };
}

function calculateTimestamp (time, mouseX) {
  return time - (mouseX / document.documentElement.clientWidth) * 5000;
}

function logStreams (DOM, streams) {
  const timeTravel = {};

  const playing$ = DOM.get('.pause', 'click')
    .scan((previous, _) => !previous, true)
    .startWith(true);

  const mousePosition$ = DOM.get('.time-travel', 'mousemove')
    .map(getMousePosition)
    .startWith({x: 0, y: 0});

  const click$ = DOM.get('.time-travel', 'click');
  const release$ = DOM.get('.time-travel', 'mouseup');

  const dragging$ = Rx.Observable.merge(
    click$.map(_ => true),
    release$.map(_ => false)
  ).startWith(false);

  const time$ = Rx.Observable.interval(16)
    .withLatestFrom(playing$, (_, playing) => ({realTime: getCurrentTime(), playing: playing}))
    .scan((oldTime, currentTime) => {
      if (currentTime.playing) {
        return currentTime;
      }

      return oldTime;
    })
    .map(currentTime => currentTime.realTime)
    .startWith(getCurrentTime());

  const timeTravelPosition$ = mousePosition$.pausable(dragging$)
    .withLatestFrom(time$, (mousePosition, time) => {
      return calculateTimestamp(time, mousePosition.x);
    }).startWith(0);

  const wowSuchCurrentTime$ = time$
    .withLatestFrom(playing$, timeTravelPosition$, (time, playing, timeTravelPosition) => {
      if (playing) {
        return time;
      }

      return timeTravelPosition;
    }).startWith(getCurrentTime())

  const loggedStreams = streams.map(streamInfo => {
    return streamInfo.stream
      .timestamp()
      .startWith([])
      .scan((events, newEvent) => {
        const newEvents = events.concat([newEvent]);

        newEvents.label = streamInfo.label;

        return newEvents;
      }, []
    );
  });

  loggedStreams.forEach((loggedStream, index) => {
    timeTravel[streams[index].label] = wowSuchCurrentTime$
      .withLatestFrom(loggedStream, (time, events) => ({events, time}))
      .map(({time, events}) => {
        return events.find(val => val.timestamp > time) || events[events.length - 1];
      })
      .filter(thing => thing.value !== undefined)
      .map(v => v.value);
  });

  return {
    DOM: Rx.Observable.combineLatest(...loggedStreams, wowSuchCurrentTime$, playing$)
      .map((things) => {
        const streamValues = things.slice(0, things.length - 2);
        const currentTime = things[things.length - 2];
        const playing = things[things.length - 1];

        return h('.time-travel', [
          h('button.pause', playing ? 'Pause' : 'Play'),
          ...streamValues.map(renderStream.bind(null, currentTime))
        ]);
      }
    ),

    timeTravel
  };
}

function main ({DOM}) {
  const userIntent = intent(DOM);
  const count$ = model(userIntent);

  const streamLogs = logStreams(DOM, [
    {stream: count$, label: 'count$'},
    {stream: count$.throttle(600), label: 'count$.throttle(600ms)'},
    {stream: count$.sample(600), label: 'count$.sample(600ms)'},
    {stream: count$.sample(1200), label: 'count$.sample(1200ms)'},
    {stream: userIntent, label: 'click$'}
  ]);

  const app = view(streamLogs.timeTravel.count$);

  return {
    DOM: Rx.Observable.combineLatest(app, streamLogs.DOM)
      .map(vtrees => (
        h('.app', vtrees)
      )
    )
  };
}

run(main, drivers);

