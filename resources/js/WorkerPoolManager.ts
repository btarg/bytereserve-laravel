export class WorkerPoolManager {
    private readonly workers: Worker[] = [];
    private readonly maxWorkers: number;
    private readonly busyWorkers = new Set<Worker>();
    private readonly taskQueue: Array<{
        task: any;
        resolve: (value: any) => void;
        reject: (reason: any) => void;
    }> = [];
    private readonly workerScript: string;

    constructor(workerScript: string, maxWorkers = navigator.hardwareConcurrency || 4) {
        this.workerScript = workerScript;
        this.maxWorkers = maxWorkers;
    }

    async runTask(task: any): Promise<any> {
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ task, resolve, reject });
            this.processQueue();
        });
    }

    private processQueue(): void {
        if (this.taskQueue.length === 0) return;

        let worker = this.getAvailableWorker();

        if (!worker && this.workers.length < this.maxWorkers) {
            worker = this.createWorker();
        }

        if (worker) {
            const nextTask = this.taskQueue.shift();
            if (nextTask) {
                this.processTaskWithWorker(worker, nextTask);
            }
        }
    }

    private getAvailableWorker(): Worker | undefined {
        return this.workers.find((worker) => !this.busyWorkers.has(worker));
    }

    private createWorker(): Worker {
        const worker = new Worker(this.workerScript);
        this.workers.push(worker);
        return worker;
    }

    private processTaskWithWorker(
        worker: Worker,
        {
            task,
            resolve,
            reject,
        }: {
            task: any;
            resolve: (value: any) => void;
            reject: (reason: any) => void;
        },
    ): void {
        this.busyWorkers.add(worker);

        const messageHandler = (e: MessageEvent) => {
            this.cleanupWorker(worker, messageHandler, errorHandler);
            resolve(e.data);
        };

        const errorHandler = (error: ErrorEvent) => {
            this.cleanupWorker(worker, messageHandler, errorHandler);
            reject(new Error(error.message));
        };

        worker.addEventListener('message', messageHandler);
        worker.addEventListener('error', errorHandler);
        worker.postMessage(task);
    }

    private cleanupWorker(
        worker: Worker,
        messageHandler: EventListener,
        errorHandler: EventListener,
    ) {
        worker.removeEventListener('message', messageHandler);
        worker.removeEventListener('error', errorHandler);
        this.busyWorkers.delete(worker);
        this.processQueue();
    }

    terminate(): void {
        this.workers.forEach((worker) => worker.terminate());
        this.workers.length = 0;
        this.busyWorkers.clear();
        this.taskQueue.length = 0;
    }
}
