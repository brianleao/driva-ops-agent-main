import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GOOGLE_CHAT_CONFIG,
  type GoogleChatConfig,
} from '../config/google-chat-config.js';
import { GoogleChatMessengerService } from '../google-chat/google-chat-messenger.service.js';
import { chatThreadUrl } from '../google-chat/google-chat-threading.js';
import type { ChatEvent } from '../google-chat/google-chat.types.js';
import type { ImprovementTicket } from './communication.types.js';
import { readCommunicationArtifacts } from './communication-artifacts.js';
import { COMMUNICATION_APPROVE_ACTION } from './communication-cards.js';
import {
  CommunicationStore,
  type PublicationClaim,
} from './communication-store.js';
import {
  publicationMention,
  renderCommunicationText,
} from './communication-text.js';

const CLAIM_REPLIES: Record<Exclude<PublicationClaim, 'claimed'>, string> = {
  already_published: 'Esta comunicação já foi publicada.',
  not_requester: 'Só quem pediu a comunicação pode aprová-la.',
  not_ready: 'Esta versão não está pronta para publicação.',
};

@Injectable()
export class CommunicationActionsService {
  private readonly logger = new Logger(CommunicationActionsService.name);

  constructor(
    private readonly store: CommunicationStore,
    private readonly messenger: GoogleChatMessengerService,
    @Inject(GOOGLE_CHAT_CONFIG) private readonly config: GoogleChatConfig,
  ) {}

  async handleAction(event: ChatEvent): Promise<{ text: string }> {
    const invokedFunction =
      event.commonEventObject?.invokedFunction ||
      event.action?.actionMethodName;
    if (invokedFunction !== COMMUNICATION_APPROVE_ACTION)
      return { text: 'Ação não reconhecida.' };
    const parameters = {
      ...Object.fromEntries(
        (event.action?.parameters || []).map(({ key, value }) => [key, value]),
      ),
      ...event.commonEventObject?.parameters,
    };
    const communicationId = parameters.communicationId;
    const version = Number(parameters.version);
    if (!communicationId || !Number.isInteger(version) || version < 1)
      return { text: 'Aprovação inválida: comunicação ou versão ausente.' };
    const newsSpace = this.config.newsSpace;
    if (!newsSpace)
      return {
        text: 'O espaço de novidades (GOOGLE_CHAT_NEWS_SPACE) não está configurado.',
      };
    const user = event.user?.name;
    if (!user) return { text: 'Não foi possível identificar o usuário.' };
    const record = await this.store.find(communicationId);
    if (!record) return { text: 'Esta comunicação não existe.' };

    const entry = record.versions.find((item) => item.number === version);
    const artifacts = entry
      ? await readCommunicationArtifacts(entry.artifactDir).catch(
          (error: unknown) =>
            error instanceof Error ? error : new Error(String(error)),
        )
      : new Error(`versão ${version} não encontrada`);
    if (!(artifacts instanceof Error) && artifacts.output.status !== 'READY') {
      this.logger.log(
        `Communication ${communicationId} v${version} approval by ${user}: output ${artifacts.output.status}`,
      );
      return { text: CLAIM_REPLIES.not_ready };
    }

    const claim = await this.store.claimPublication(
      communicationId,
      version,
      user,
    );
    if (claim !== 'claimed') {
      this.logger.log(
        `Communication ${communicationId} v${version} approval by ${user}: ${claim}`,
      );
      return { text: CLAIM_REPLIES[claim] };
    }

    let unmentioned: string[];
    let published: { messageName: string | null; threadName?: string };
    try {
      if (artifacts instanceof Error) throw artifacts;
      const mentions = await this.resolveMentions(
        newsSpace,
        artifacts.tickets,
        communicationId,
      );
      unmentioned = mentions.unmentioned;
      published = await this.messenger.sendText(
        newsSpace,
        renderCommunicationText(artifacts.output, artifacts.tickets, (ticket) =>
          publicationMention(ticket, mentions.userNames),
        ),
      );
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(
        `Communication ${communicationId} v${version} publication failed: ${message}`,
      );
      await this.store.releasePublication(communicationId);
      return { text: `Não consegui publicar a comunicação: ${message}` };
    }

    try {
      await this.store.completePublication(
        communicationId,
        published.messageName ?? '',
      );
    } catch (error) {
      this.logger.error(
        `Communication ${communicationId} published but state update failed: ${(error as Error).message}`,
      );
    }
    this.logger.log(
      `Communication ${communicationId} v${version} published by ${user}: ${published.messageName ?? 'unknown'}`,
    );
    const link = chatThreadUrl(published.threadName);
    const text = link
      ? `Versão ${version} publicada no espaço de novidades: ${link}`
      : `Versão ${version} publicada no espaço de novidades.`;
    return {
      text: unmentioned.length
        ? `${text}\nSem marcação no Chat: ${unmentioned.join(', ')}. A citação pelo nome foi preservada.`
        : text,
    };
  }

  private async resolveMentions(
    space: string,
    tickets: ImprovementTicket[],
    communicationId: string,
  ) {
    const userNames = new Map<string, string>();
    const attempted = new Set<string>();
    const unmentioned = new Set<string>();
    for (const owner of tickets.flatMap((ticket) => ticket.owners)) {
      const email = owner.email?.trim().toLowerCase();
      if (email && !attempted.has(email)) {
        attempted.add(email);
        try {
          const name = await this.messenger.resolveMemberName(space, email);
          if (name && /^users\/\d+$/.test(name)) userNames.set(email, name);
        } catch (error) {
          this.logger.warn(
            `Communication ${communicationId} membership lookup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!email || !userNames.has(email)) {
        unmentioned.add(owner.username);
        this.logger.warn(
          `Communication ${communicationId}: ${owner.username} will be cited without a Chat mention`,
        );
      }
    }
    return { userNames, unmentioned: [...unmentioned] };
  }
}
