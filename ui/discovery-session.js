// Host adapter: one completed user/assistant round -> one provider scan.
// No networking, generation calls, DOM observers or button-triggered scans.
export function createDiscoverySession({ context, identity, read, enabled, busy, scan, onError }) {
    let generation, pending, scanning = false;
    const attempted = new WeakMap();
    const sameChat = (a, b) => a.chatMetadata === b.chatMetadata && identity(a).key === identity(b).key;
    return {
        start(type, _options, dryRun) {
            generation = undefined;
            if (dryRun || ![undefined, 'normal'].includes(type)) return;
            const ctx = context();
            if (!enabled(ctx)) return;
            generation = { ctx, before: ctx.chat?.length ?? 0, received: -1 };
        },
        received(id) {
            if (generation && Number.isInteger(id)) {
                generation.received = id;
                if (generation.ended) return this.complete(generation);
            }
        },
        cancel() { generation = undefined; pending = undefined; },
        end() {
            if (!generation) return;
            generation.ended = true;
            return this.complete(generation);
        },
        async complete(current) {
            // STOPPED can follow ENDED synchronously in the host.
            await Promise.resolve();
            if (!current || generation !== current || !current.ended || current.received < 0) return;
            generation = undefined;
            const ctx = context();
            if (!sameChat(ctx, current.ctx) || !enabled(ctx) || ctx.streamingProcessor?.isStopped || ctx.streamingProcessor?.abortController?.signal?.aborted) return;
            const messages = ctx.chat ?? [], index = messages.length - 1;
            const assistant = messages[index];
            if (current.received !== index || index < current.before || assistant?.is_user !== false || assistant.is_system || !assistant.mes?.trim()) return;
            let userIndex = index - 1;
            while (userIndex >= 0 && !messages[userIndex].is_user) userIndex--;
            const user = messages[userIndex];
            if (!user || user.is_system || !user.mes?.trim() || user.mes.trimStart().startsWith('/')) return;
            const turnId = JSON.stringify([userIndex, user.send_date ?? null]);
            if (read(ctx).discoveryScan?.lastTurnId === turnId) return;
            pending = { ctx, turnId, messages: [{ role: 'user', text: user.mes }, { role: 'assistant', text: assistant.mes }] };
            await this.flush();
        },
        async flush() {
            if (!pending || busy() || scanning) return;
            const item = pending; pending = undefined;
            if (!sameChat(context(), item.ctx) || !enabled(context()) || read(context()).discoveryScan?.lastTurnId === item.turnId) return;
            const turns = attempted.get(item.ctx.chatMetadata) ?? new Set();
            if (turns.has(item.turnId)) return;
            turns.add(item.turnId); attempted.set(item.ctx.chatMetadata, turns);
            scanning = true;
            try { await scan(item); } catch (error) { onError(error); }
            finally { scanning = false; }
            await this.flush();
        },
    };
}
