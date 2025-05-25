import { App, TFile } from "obsidian";
import { FlashcardData, CardStatus, StudySession, FlashcardStats } from "./flashcard-model";
import { SM2Algorithm } from "./sm2-algorithm";
import { getDefFileManager } from "./def-file-manager";
import { DefFileType } from "./file-type";
import { getSettings } from "../settings";

export class FlashcardManager {
	app: App;
	studySessions: StudySession[] = [];

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 从插件数据中加载学习会话数据
	 */
	async loadData(data: any) {
		if (data.studySessions) {
			this.studySessions = data.studySessions;
		}
	}

	/**
	 * 保存学习会话数据到插件数据
	 */
	getData(): any {
		return {
			studySessions: this.studySessions
		};
	}

	/**
	 * 从atomic文件的frontmatter中读取闪卡数据
	 */
	private async getCardDataFromFile(file: TFile): Promise<FlashcardData | null> {
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatter = fileCache?.frontmatter;

		if (!frontmatter) {
			return null;
		}

		// 检查是否有闪卡数据
		const cardData = frontmatter['flashcard'];
		if (!cardData) {
			return null;
		}

		return {
			definitionKey: file.basename,
			filePath: file.path,
			status: cardData.status || CardStatus.New,
			easeFactor: cardData.easeFactor || 2.5,
			interval: cardData.interval || 0,
			repetitions: cardData.repetitions || 0,
			nextReviewDate: cardData.nextReviewDate || Date.now(),
			createdDate: cardData.createdDate || file.stat.ctime,
			lastReviewDate: cardData.lastReviewDate || 0,
			totalReviews: cardData.totalReviews || 0,
			correctReviews: cardData.correctReviews || 0
		};
	}

	/**
	 * 将闪卡数据保存到atomic文件的frontmatter中
	 */
	private async saveCardDataToFile(file: TFile, cardData: FlashcardData): Promise<void> {
		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		
		// 查找frontmatter边界
		let frontmatterStart = -1;
		let frontmatterEnd = -1;
		
		if (lines[0] === '---') {
			frontmatterStart = 0;
			for (let i = 1; i < lines.length; i++) {
				if (lines[i] === '---') {
					frontmatterEnd = i;
					break;
				}
			}
		}

		const flashcardData = {
			status: cardData.status,
			easeFactor: cardData.easeFactor,
			interval: cardData.interval,
			repetitions: cardData.repetitions,
			nextReviewDate: cardData.nextReviewDate,
			createdDate: cardData.createdDate,
			lastReviewDate: cardData.lastReviewDate,
			totalReviews: cardData.totalReviews,
			correctReviews: cardData.correctReviews
		};

		if (frontmatterStart === -1) {
			// 没有frontmatter，创建新的
			const newFrontmatter = [
				'---',
				'flashcard:',
				...Object.entries(flashcardData).map(([key, value]) => `  ${key}: ${value}`),
				'---',
				''
			];
			const newContent = newFrontmatter.concat(lines).join('\n');
			await this.app.vault.modify(file, newContent);
		} else {
			// 更新现有frontmatter
			const beforeFrontmatter = lines.slice(0, frontmatterStart + 1);
			const afterFrontmatter = lines.slice(frontmatterEnd);
			
			// 解析现有frontmatter
			const frontmatterLines = lines.slice(frontmatterStart + 1, frontmatterEnd);
			const updatedFrontmatter = [];
			let flashcardSectionFound = false;
			let inFlashcardSection = false;
			
			for (const line of frontmatterLines) {
				if (line.startsWith('flashcard:')) {
					flashcardSectionFound = true;
					inFlashcardSection = true;
					updatedFrontmatter.push('flashcard:');
					Object.entries(flashcardData).forEach(([key, value]) => {
						updatedFrontmatter.push(`  ${key}: ${value}`);
					});
				} else if (inFlashcardSection && line.startsWith('  ')) {
					// 跳过旧的flashcard数据
					continue;
				} else {
					inFlashcardSection = false;
					updatedFrontmatter.push(line);
				}
			}
			
			// 如果没有找到flashcard部分，添加它
			if (!flashcardSectionFound) {
				updatedFrontmatter.push('flashcard:');
				Object.entries(flashcardData).forEach(([key, value]) => {
					updatedFrontmatter.push(`  ${key}: ${value}`);
				});
			}
			
			const newContent = beforeFrontmatter
				.concat(updatedFrontmatter)
				.concat(afterFrontmatter)
				.join('\n');
			
			await this.app.vault.modify(file, newContent);
		}
	}

	/**
	 * 获取所有atomic类型的定义文件
	 */
	private getAtomicDefinitionFiles(): TFile[] {
		const defManager = getDefFileManager();
		const atomicFiles: TFile[] = [];

		for (const [filePath, file] of defManager.globalDefFiles) {
			const fileType = defManager.getFileType(file);
			if (fileType === DefFileType.Atomic) {
				atomicFiles.push(file);
			}
		}

		return atomicFiles;
	}

	/**
	 * 获取今日学习队列（仅atomic文件）
	 */
	async getTodayStudyQueue(): Promise<FlashcardData[]> {
		const settings = getSettings();
		const { dailyNewCards, dailyReviewLimit, studyScope } = settings.flashcardConfig!;
		
		// 获取今日已学习的卡片数量
		const today = new Date().toISOString().split('T')[0];
		const todaySession = this.studySessions.find(s => s.date === today);
		const todayNewCards = todaySession?.newCardsStudied || 0;
		const todayReviewCards = todaySession?.reviewCardsStudied || 0;

		// 获取所有atomic文件
		const atomicFiles = this.getAtomicDefinitionFiles();
		
		// 筛选在学习范围内的文件
		const scopeFiles = atomicFiles.filter(file => {
			if (studyScope.length === 0) return true;
			return studyScope.some(scope => {
				if (scope.endsWith('/')) {
					// 文件夹范围
					return file.path.startsWith(scope);
				} else {
					// 文件范围
					return file.path === scope;
				}
			});
		});

		// 读取所有卡片数据
		const allCards: FlashcardData[] = [];
		for (const file of scopeFiles) {
			const cardData = await this.getCardDataFromFile(file);
			if (cardData) {
				allCards.push(cardData);
			} else {
				// 为新文件创建默认卡片数据
				const newCard = SM2Algorithm.createNewCard(file.basename, file.path);
				allCards.push(newCard);
			}
		}

		// 获取到期的复习卡片
		const dueReviewCards = allCards
			.filter(card => 
				card.status !== CardStatus.New && 
				SM2Algorithm.isDue(card)
			)
			.sort((a, b) => SM2Algorithm.getPriority(a) - SM2Algorithm.getPriority(b))
			.slice(0, Math.max(0, dailyReviewLimit - todayReviewCards));

		// 获取新卡片
		const newCards = allCards
			.filter(card => card.status === CardStatus.New)
			.sort((a, b) => a.createdDate - b.createdDate)
			.slice(0, Math.max(0, dailyNewCards - todayNewCards));

		return [...dueReviewCards, ...newCards];
	}

	/**
	 * 更新闪卡学习结果
	 */
	async updateCardResult(filePath: string, result: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) {
			console.error('File not found:', filePath);
			return;
		}

		const cardData = await this.getCardDataFromFile(file);
		
		if (!cardData) {
			// 如果没有现有数据，创建新的卡片数据
			const newCard = SM2Algorithm.createNewCard(file.basename, file.path);
			const updatedCard = SM2Algorithm.updateCard(newCard, result);
			await this.saveCardDataToFile(file, updatedCard);
			this.updateTodaySession(true); // 新卡片
			return;
		}

		const wasNew = cardData.status === CardStatus.New;
		const updatedCard = SM2Algorithm.updateCard(cardData, result);
		
		// 保存更新后的数据到文件
		await this.saveCardDataToFile(file, updatedCard);

		// 更新今日学习统计
		this.updateTodaySession(wasNew);
	}

	/**
	 * 更新今日学习统计
	 */
	private updateTodaySession(wasNewCard: boolean) {
		const today = new Date().toISOString().split('T')[0];
		let todaySession = this.studySessions.find(s => s.date === today);
		
		if (!todaySession) {
			todaySession = {
				date: today,
				newCardsStudied: 0,
				reviewCardsStudied: 0,
				totalTime: 0
			};
			this.studySessions.push(todaySession);
		}

		if (wasNewCard) {
			todaySession.newCardsStudied++;
		} else {
			todaySession.reviewCardsStudied++;
		}
	}

	/**
	 * 获取闪卡统计信息
	 */
	async getStats(): Promise<FlashcardStats> {
		const atomicFiles = this.getAtomicDefinitionFiles();
		const allCards: FlashcardData[] = [];
		
		for (const file of atomicFiles) {
			const cardData = await this.getCardDataFromFile(file);
			if (cardData) {
				allCards.push(cardData);
			} else {
				// 新文件算作新卡片
				allCards.push(SM2Algorithm.createNewCard(file.basename, file.path));
			}
		}

		const today = new Date().toISOString().split('T')[0];
		const todaySession = this.studySessions.find(s => s.date === today);

		// 计算额外统计数据
		const recentSessions = this.studySessions.slice(-30);
		const weeklyAverage = this.calculateWeeklyAverage(recentSessions);
		const monthlyTotal = this.calculateMonthlyTotal(recentSessions);
		const currentStreak = this.calculateCurrentStreak();
		const longestStreak = this.calculateLongestStreak();
		const totalStudyTime = this.calculateTotalStudyTime();
		const averageAccuracy = this.calculateAverageAccuracy(allCards);

		return {
			totalCards: allCards.length,
			newCards: allCards.filter(c => c.status === CardStatus.New).length,
			learningCards: allCards.filter(c => c.status === CardStatus.Learning).length,
			reviewCards: allCards.filter(c => c.status === CardStatus.Review).length,
			graduatedCards: allCards.filter(c => c.status === CardStatus.Graduated).length,
			todayNewCards: todaySession?.newCardsStudied || 0,
			todayReviewCards: todaySession?.reviewCardsStudied || 0,
			studySessions: recentSessions,
			weeklyAverage,
			monthlyTotal,
			currentStreak,
			longestStreak,
			totalStudyTime,
			averageAccuracy
		};
	}

	// 计算每周平均学习卡片数
	private calculateWeeklyAverage(sessions: StudySession[]): number {
		if (sessions.length === 0) return 0;
		
		const weekSessions = sessions.slice(-7);
		const totalCards = weekSessions.reduce((sum, session) => 
			sum + session.newCardsStudied + session.reviewCardsStudied, 0);
		
		return Math.round(totalCards / 7 * 10) / 10;
	}

	// 计算本月总学习数
	private calculateMonthlyTotal(sessions: StudySession[]): number {
		const currentMonth = new Date().getMonth();
		const currentYear = new Date().getFullYear();
		
		return sessions
			.filter(session => {
				const sessionDate = new Date(session.date);
				return sessionDate.getMonth() === currentMonth && 
					   sessionDate.getFullYear() === currentYear;
			})
			.reduce((sum, session) => 
				sum + session.newCardsStudied + session.reviewCardsStudied, 0);
	}

	// 计算当前连续学习天数
	private calculateCurrentStreak(): number {
		if (this.studySessions.length === 0) return 0;
		
		const sortedSessions = [...this.studySessions].sort((a, b) => 
			new Date(b.date).getTime() - new Date(a.date).getTime());
		
		let streak = 0;
		const today = new Date();
		
		for (let i = 0; i < sortedSessions.length; i++) {
			const sessionDate = new Date(sortedSessions[i].date);
			const daysDiff = Math.floor((today.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));
			
			if (daysDiff === i) {
				const totalStudied = sortedSessions[i].newCardsStudied + sortedSessions[i].reviewCardsStudied;
				if (totalStudied > 0) {
					streak++;
				} else {
					break;
				}
			} else {
				break;
			}
		}
		
		return streak;
	}

	// 计算最长连续学习天数
	private calculateLongestStreak(): number {
		if (this.studySessions.length === 0) return 0;
		
		const sortedSessions = [...this.studySessions].sort((a, b) => 
			new Date(a.date).getTime() - new Date(b.date).getTime());
		
		let maxStreak = 0;
		let currentStreak = 0;
		let lastDate: Date | null = null;
		
		for (const session of sortedSessions) {
			const sessionDate = new Date(session.date);
			const totalStudied = session.newCardsStudied + session.reviewCardsStudied;
			
			if (totalStudied > 0) {
				if (lastDate === null || 
					Math.floor((sessionDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) === 1) {
					currentStreak++;
					maxStreak = Math.max(maxStreak, currentStreak);
				} else {
					currentStreak = 1;
				}
				lastDate = sessionDate;
			} else {
				currentStreak = 0;
			}
		}
		
		return maxStreak;
	}

	// 计算总学习时间（分钟）
	private calculateTotalStudyTime(): number {
		return Math.round(this.studySessions.reduce((sum, session) => 
			sum + session.totalTime, 0) / 60);
	}

	// 计算平均正确率
	private calculateAverageAccuracy(cards: FlashcardData[]): number {
		const cardsWithReviews = cards.filter(card => card.totalReviews > 0);
		if (cardsWithReviews.length === 0) return 0;
		
		const totalAccuracy = cardsWithReviews.reduce((sum, card) => 
			sum + (card.correctReviews / card.totalReviews), 0);
		
		return Math.round(totalAccuracy / cardsWithReviews.length * 100) / 100;
	}

	/**
	 * 获取consolidated文件列表（用于浏览模式）
	 */
	getConsolidatedFiles(): TFile[] {
		const defManager = getDefFileManager();
		return defManager.getConsolidatedDefFiles();
	}

	/**
	 * 获取consolidated文件中的所有定义（用于浏览模式）
	 */
	getDefinitionsFromConsolidatedFiles(files: TFile[]): Array<{file: TFile, definitions: any[]}> {
		const defManager = getDefFileManager();
		const result: Array<{file: TFile, definitions: any[]}> = [];

		files.forEach(file => {
			const definitions = defManager.getDefinitionsFromFile(file);
			if (definitions.length > 0) {
				result.push({ file, definitions });
			}
		});

		return result;
	}
} 