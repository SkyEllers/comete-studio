/** Formes partagées entre le chargement serveur, le store et les composants. */

export type BoardMember = {
  id: string;
  name: string;
  email: string;
};

export type BoardLabel = {
  id: string;
  name: string;
  color: string;
};

export type BoardList = {
  id: string;
  name: string;
  position: number;
};

export type BoardCard = {
  id: string;
  listId: string;
  title: string;
  description: string;
  position: number;
  dueDate: string | null;
  isCompleted: boolean;
  coverColor: string | null;
  labelIds: string[];
  assigneeIds: string[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
};

export type BoardSelf = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  color: string;
  isArchived: boolean;
};

export type BoardData = {
  board: BoardSelf;
  lists: BoardList[];
  cards: BoardCard[];
  labels: BoardLabel[];
  members: BoardMember[];
  /** L'utilisateur peut-il supprimer ce tableau (rôle owner, ou Louis) ? */
  canDelete: boolean;
};
