export class TaskQueue {
  private queue: Promise<void>;

  constructor() {
    this.queue = Promise.resolve();
  }

  add(task: () => Promise<any>) {
    const resultPromises = this.queue.then(() => task());

    this.queue = resultPromises.catch((err) => {
      console.error(err);
    });

    return resultPromises;
  }
}
