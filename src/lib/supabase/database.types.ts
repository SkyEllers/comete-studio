export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_bilans: {
        Row: {
          a_repondu: boolean
          confirme: boolean
          created_at: string
          delai_jours: number
          etat_final: string
          id: string
          messages_libres: number
          modeles_envoyes: number
          mois: string
          organization_id: string
          questions_montees: number
          reports_agent: number
          sans_reponse_veille: boolean
          simulation: boolean
          stop: boolean
        }
        Insert: {
          a_repondu: boolean
          confirme: boolean
          created_at?: string
          delai_jours: number
          etat_final: string
          id?: string
          messages_libres: number
          modeles_envoyes: number
          mois: string
          organization_id: string
          questions_montees: number
          reports_agent: number
          sans_reponse_veille: boolean
          simulation: boolean
          stop: boolean
        }
        Update: {
          a_repondu?: boolean
          confirme?: boolean
          created_at?: string
          delai_jours?: number
          etat_final?: string
          id?: string
          messages_libres?: number
          modeles_envoyes?: number
          mois?: string
          organization_id?: string
          questions_montees?: number
          reports_agent?: number
          sans_reponse_veille?: boolean
          simulation?: boolean
          stop?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "agent_bilans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          booking_id: string | null
          confirme_le: string | null
          contenu_propose_le: string | null
          created_at: string
          creneaux_proposes: string[]
          decalage: string
          derniere_entree_le: string | null
          efface_apres: string
          email: string | null
          etat: string
          event_type_uri: string | null
          event_uri: string | null
          facon_de_decider: string | null
          fuseau: string
          id: string
          invitee_uri: string
          invites_precedents: string[]
          lien_annulation: string | null
          lien_report: string | null
          lien_visio: string | null
          nom: string | null
          organization_id: string
          premiere_reponse_le: string | null
          prenom: string
          rdv_debut: string
          rdv_fin: string
          reponses: Json
          report_attendu: string | null
          report_demande_le: string | null
          reports_agent: number
          reserve_le: string
          sans_reponse_veille: boolean
          simulation: boolean
          stop_le: string | null
          telephone: string | null
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          confirme_le?: string | null
          contenu_propose_le?: string | null
          created_at?: string
          creneaux_proposes?: string[]
          decalage?: string
          derniere_entree_le?: string | null
          efface_apres: string
          email?: string | null
          etat?: string
          event_type_uri?: string | null
          event_uri?: string | null
          facon_de_decider?: string | null
          fuseau?: string
          id?: string
          invitee_uri: string
          invites_precedents?: string[]
          lien_annulation?: string | null
          lien_report?: string | null
          lien_visio?: string | null
          nom?: string | null
          organization_id: string
          premiere_reponse_le?: string | null
          prenom: string
          rdv_debut: string
          rdv_fin: string
          reponses?: Json
          report_attendu?: string | null
          report_demande_le?: string | null
          reports_agent?: number
          reserve_le: string
          sans_reponse_veille?: boolean
          simulation?: boolean
          stop_le?: string | null
          telephone?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          confirme_le?: string | null
          contenu_propose_le?: string | null
          created_at?: string
          creneaux_proposes?: string[]
          decalage?: string
          derniere_entree_le?: string | null
          efface_apres?: string
          email?: string | null
          etat?: string
          event_type_uri?: string | null
          event_uri?: string | null
          facon_de_decider?: string | null
          fuseau?: string
          id?: string
          invitee_uri?: string
          invites_precedents?: string[]
          lien_annulation?: string | null
          lien_report?: string | null
          lien_visio?: string | null
          nom?: string | null
          organization_id?: string
          premiere_reponse_le?: string | null
          prenom?: string
          rdv_debut?: string
          rdv_fin?: string
          reponses?: Json
          report_attendu?: string | null
          report_demande_le?: string | null
          reports_agent?: number
          reserve_le?: string
          sans_reponse_veille?: boolean
          simulation?: boolean
          stop_le?: string | null
          telephone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          boutons: string[]
          canal: string
          cle_envoi: string | null
          comprehension: Json | null
          conversation_id: string
          created_at: string
          erreur: string | null
          genre: string
          id: string
          id_externe: string | null
          modele: string | null
          organization_id: string
          sens: string
          statut: string
          texte: string
        }
        Insert: {
          boutons?: string[]
          canal: string
          cle_envoi?: string | null
          comprehension?: Json | null
          conversation_id: string
          created_at?: string
          erreur?: string | null
          genre: string
          id?: string
          id_externe?: string | null
          modele?: string | null
          organization_id: string
          sens: string
          statut?: string
          texte: string
        }
        Update: {
          boutons?: string[]
          canal?: string
          cle_envoi?: string | null
          comprehension?: Json | null
          conversation_id?: string
          created_at?: string
          erreur?: string | null
          genre?: string
          id?: string
          id_externe?: string | null
          modele?: string | null
          organization_id?: string
          sens?: string
          statut?: string
          texte?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_questions: {
        Row: {
          brouillon: string | null
          conversation_id: string
          created_at: string
          etat: string
          genre: string
          id: string
          message_id: string | null
          notifie_le: string | null
          organization_id: string
          question: string
          reponse: string | null
          traitee_le: string | null
        }
        Insert: {
          brouillon?: string | null
          conversation_id: string
          created_at?: string
          etat?: string
          genre: string
          id?: string
          message_id?: string | null
          notifie_le?: string | null
          organization_id: string
          question: string
          reponse?: string | null
          traitee_le?: string | null
        }
        Update: {
          brouillon?: string | null
          conversation_id?: string
          created_at?: string
          etat?: string
          genre?: string
          id?: string
          message_id?: string | null
          notifie_le?: string | null
          organization_id?: string
          question?: string
          reponse?: string | null
          traitee_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_questions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_questions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "agent_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reglages: {
        Row: {
          actif: boolean
          canal: string
          created_at: string
          delai_minimum: string
          organization_id: string
          profil: string
          resume_actif: boolean
          resume_destinataires: string[]
          resume_envoye_le: string | null
          types_suivis: string[]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          canal?: string
          created_at?: string
          delai_minimum?: string
          organization_id: string
          profil: string
          resume_actif?: boolean
          resume_destinataires?: string[]
          resume_envoye_le?: string | null
          types_suivis?: string[]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          canal?: string
          created_at?: string
          delai_minimum?: string
          organization_id?: string
          profil?: string
          resume_actif?: boolean
          resume_destinataires?: string[]
          resume_envoye_le?: string | null
          types_suivis?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_reglages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reponses_fixes: {
        Row: {
          actif: boolean
          created_at: string
          id: string
          organization_id: string
          question: string
          reponse: string
          updated_at: string
        }
        Insert: {
          actif?: boolean
          created_at?: string
          id?: string
          organization_id: string
          question: string
          reponse: string
          updated_at?: string
        }
        Update: {
          actif?: boolean
          created_at?: string
          id?: string
          organization_id?: string
          question?: string
          reponse?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_reponses_fixes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automatisations: {
        Row: {
          actif: boolean
          attendue_le: string | null
          cadence: string
          client: string
          depot: string
          etat: string
          mail_attendu: string
          nom: string
          ordre: number
          prochaine_le: string | null
          recu_le: string | null
          recu_objet: string | null
          releve_le: string
          run_le: string | null
          run_statut: string | null
          run_url: string | null
          slug: string
          workflow: string
        }
        Insert: {
          actif?: boolean
          attendue_le?: string | null
          cadence: string
          client: string
          depot: string
          etat?: string
          mail_attendu?: string
          nom: string
          ordre?: number
          prochaine_le?: string | null
          recu_le?: string | null
          recu_objet?: string | null
          releve_le?: string
          run_le?: string | null
          run_statut?: string | null
          run_url?: string | null
          slug: string
          workflow: string
        }
        Update: {
          actif?: boolean
          attendue_le?: string | null
          cadence?: string
          client?: string
          depot?: string
          etat?: string
          mail_attendu?: string
          nom?: string
          ordre?: number
          prochaine_le?: string | null
          recu_le?: string | null
          recu_objet?: string | null
          releve_le?: string
          run_le?: string | null
          run_statut?: string | null
          run_url?: string | null
          slug?: string
          workflow?: string
        }
        Relationships: []
      }
      automatisations_passages: {
        Row: {
          attendue_le: string
          etat: string
          recu_le: string | null
          recu_objet: string | null
          run_statut: string | null
          run_url: string | null
          slug: string
        }
        Insert: {
          attendue_le: string
          etat: string
          recu_le?: string | null
          recu_objet?: string | null
          run_statut?: string | null
          run_url?: string | null
          slug: string
        }
        Update: {
          attendue_le?: string
          etat?: string
          recu_le?: string | null
          recu_objet?: string | null
          run_statut?: string | null
          run_url?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "automatisations_passages_slug_fkey"
            columns: ["slug"]
            isOneToOne: false
            referencedRelation: "automatisations"
            referencedColumns: ["slug"]
          },
        ]
      }
      boards: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      card_activities: {
        Row: {
          board_id: string
          card_id: string
          created_at: string
          id: string
          payload: Json
          type: string
          user_id: string | null
        }
        Insert: {
          board_id: string
          card_id: string
          created_at?: string
          id?: string
          payload?: Json
          type: string
          user_id?: string | null
        }
        Update: {
          board_id?: string
          card_id?: string
          created_at?: string
          id?: string
          payload?: Json
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_activities_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_activities_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      card_assignees: {
        Row: {
          board_id: string
          card_id: string
          user_id: string
        }
        Insert: {
          board_id: string
          card_id: string
          user_id: string
        }
        Update: {
          board_id?: string
          card_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_assignees_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_assignees_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      card_labels: {
        Row: {
          board_id: string
          card_id: string
          label_id: string
        }
        Insert: {
          board_id: string
          card_id: string
          label_id: string
        }
        Update: {
          board_id?: string
          card_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_labels_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_labels_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          board_id: string
          cover_color: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          id: string
          is_archived: boolean
          is_completed: boolean
          list_id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          board_id: string
          cover_color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          is_archived?: boolean
          is_completed?: boolean
          list_id: string
          position?: number
          title: string
          updated_at?: string
        }
        Update: {
          board_id?: string
          cover_color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          id?: string
          is_archived?: boolean
          is_completed?: boolean
          list_id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          board_id: string
          checklist_id: string
          id: string
          is_done: boolean
          position: number
          text: string
        }
        Insert: {
          board_id: string
          checklist_id: string
          id?: string
          is_done?: boolean
          position?: number
          text: string
        }
        Update: {
          board_id?: string
          checklist_id?: string
          id?: string
          is_done?: boolean
          position?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          board_id: string
          card_id: string
          id: string
          position: number
          title: string
        }
        Insert: {
          board_id: string
          card_id: string
          id?: string
          position?: number
          title?: string
        }
        Update: {
          board_id?: string
          card_id?: string
          id?: string
          position?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          board_id: string
          body: string
          card_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          board_id: string
          body: string
          card_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          board_id?: string
          body?: string
          card_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          duration_seconds: number | null
          folder_id: string | null
          height: number | null
          id: string
          mime_type: string
          name: string
          organization_id: string
          size_bytes: number
          status: Database["public"]["Enums"]["file_status"]
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          folder_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string
          name: string
          organization_id: string
          size_bytes: number
          status?: Database["public"]["Enums"]["file_status"]
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          folder_id?: string | null
          height?: number | null
          id?: string
          mime_type?: string
          name?: string
          organization_id?: string
          size_bytes?: number
          status?: Database["public"]["Enums"]["file_status"]
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      horizon_releves: {
        Row: {
          contenu: Json
          created_at: string
          id: string
          mois: string
          organization_id: string
          publie: boolean
          updated_at: string
        }
        Insert: {
          contenu?: Json
          created_at?: string
          id?: string
          mois: string
          organization_id: string
          publie?: boolean
          updated_at?: string
        }
        Update: {
          contenu?: Json
          created_at?: string
          id?: string
          mois?: string
          organization_id?: string
          publie?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "horizon_releves_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          board_id: string
          color: string
          id: string
          name: string
        }
        Insert: {
          board_id: string
          color: string
          id?: string
          name?: string
        }
        Update: {
          board_id?: string
          color?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          board_id: string
          created_at: string
          id: string
          is_archived: boolean
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lists_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_batches: {
        Row: {
          folder_id: string | null
          id: string
          organization_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          folder_id?: string | null
          id?: string
          organization_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          folder_id?: string | null
          id?: string
          organization_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_batches_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_tools: {
        Row: {
          enabled: boolean
          enabled_at: string
          organization_id: string
          tool_id: string
        }
        Insert: {
          enabled?: boolean
          enabled_at?: string
          organization_id: string
          tool_id: string
        }
        Update: {
          enabled?: boolean
          enabled_at?: string
          organization_id?: string
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_tools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_tools_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      prospection_demandes: {
        Row: {
          bloques: number | null
          commencee_le: string | null
          compte_rendu: string | null
          demandee_le: string
          en_file: number | null
          envoi_exclus: string[]
          envoi_valide_le: string | null
          envoyes: number | null
          etape: string | null
          finie_le: string | null
          id: string
          messages: Json
          nombre: number
          statut: string
          trouves: number | null
          updated_at: string
        }
        Insert: {
          bloques?: number | null
          commencee_le?: string | null
          compte_rendu?: string | null
          demandee_le?: string
          en_file?: number | null
          envoi_exclus?: string[]
          envoi_valide_le?: string | null
          envoyes?: number | null
          etape?: string | null
          finie_le?: string | null
          id?: string
          messages?: Json
          nombre: number
          statut?: string
          trouves?: number | null
          updated_at?: string
        }
        Update: {
          bloques?: number | null
          commencee_le?: string | null
          compte_rendu?: string | null
          demandee_le?: string
          en_file?: number | null
          envoi_exclus?: string[]
          envoi_valide_le?: string | null
          envoyes?: number | null
          etape?: string | null
          finie_le?: string | null
          id?: string
          messages?: Json
          nombre?: number
          statut?: string
          trouves?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      prospection_prospects: {
        Row: {
          avis_google: number | null
          canal: string | null
          cible: string
          contact: string | null
          contacte_le: string | null
          historique: Json
          importe_le: string
          liens: Json
          maj_vault: string | null
          message: string | null
          message_titre: string | null
          metier: string | null
          nom: string
          note: number | null
          note_detail: string | null
          question: string | null
          relance_le: string | null
          slug: string
          source: string | null
          statut: string
          tri_rapide: string | null
          video: string | null
          ville: string | null
        }
        Insert: {
          avis_google?: number | null
          canal?: string | null
          cible?: string
          contact?: string | null
          contacte_le?: string | null
          historique?: Json
          importe_le?: string
          liens?: Json
          maj_vault?: string | null
          message?: string | null
          message_titre?: string | null
          metier?: string | null
          nom: string
          note?: number | null
          note_detail?: string | null
          question?: string | null
          relance_le?: string | null
          slug: string
          source?: string | null
          statut?: string
          tri_rapide?: string | null
          video?: string | null
          ville?: string | null
        }
        Update: {
          avis_google?: number | null
          canal?: string | null
          cible?: string
          contact?: string | null
          contacte_le?: string | null
          historique?: Json
          importe_le?: string
          liens?: Json
          maj_vault?: string | null
          message?: string | null
          message_titre?: string | null
          metier?: string | null
          nom?: string
          note?: number | null
          note_detail?: string | null
          question?: string | null
          relance_le?: string | null
          slug?: string
          source?: string | null
          statut?: string
          tri_rapide?: string | null
          video?: string | null
          ville?: string | null
        }
        Relationships: []
      }
      prospection_suivi: {
        Row: {
          classe: boolean
          relance_envoyee_le: string | null
          relance_type: string | null
          reponse: string | null
          reponse_le: string | null
          slug: string
          updated_at: string
          video_filmee_le: string | null
        }
        Insert: {
          classe?: boolean
          relance_envoyee_le?: string | null
          relance_type?: string | null
          reponse?: string | null
          reponse_le?: string | null
          slug: string
          updated_at?: string
          video_filmee_le?: string | null
        }
        Update: {
          classe?: boolean
          relance_envoyee_le?: string | null
          relance_type?: string | null
          reponse?: string | null
          reponse_le?: string | null
          slug?: string
          updated_at?: string
          video_filmee_le?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospection_suivi_slug_fkey"
            columns: ["slug"]
            isOneToOne: true
            referencedRelation: "prospection_prospects"
            referencedColumns: ["slug"]
          },
        ]
      }
      pulsar_clients: {
        Row: {
          created_at: string
          date_debut: string | null
          fin_engagement: string | null
          id: string
          is_internal: boolean
          linked_organization_id: string | null
          modele: Database["public"]["Enums"]["pulsar_modele"]
          montant_cents: number
          name: string
          organization_id: string
          profil: Database["public"]["Enums"]["pulsar_profil"] | null
          statut: Database["public"]["Enums"]["pulsar_statut"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_debut?: string | null
          fin_engagement?: string | null
          id?: string
          is_internal?: boolean
          linked_organization_id?: string | null
          modele?: Database["public"]["Enums"]["pulsar_modele"]
          montant_cents?: number
          name: string
          organization_id: string
          profil?: Database["public"]["Enums"]["pulsar_profil"] | null
          statut?: Database["public"]["Enums"]["pulsar_statut"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_debut?: string | null
          fin_engagement?: string | null
          id?: string
          is_internal?: boolean
          linked_organization_id?: string | null
          modele?: Database["public"]["Enums"]["pulsar_modele"]
          montant_cents?: number
          name?: string
          organization_id?: string
          profil?: Database["public"]["Enums"]["pulsar_profil"] | null
          statut?: Database["public"]["Enums"]["pulsar_statut"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulsar_clients_linked_organization_id_fkey"
            columns: ["linked_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pulsar_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pulsar_entries: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          is_manual: boolean
          note: string | null
          organization_id: string
          phase: Database["public"]["Enums"]["pulsar_phase"]
          started_at: string
          task: Database["public"]["Enums"]["pulsar_task"]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          note?: string | null
          organization_id: string
          phase: Database["public"]["Enums"]["pulsar_phase"]
          started_at: string
          task: Database["public"]["Enums"]["pulsar_task"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          note?: string | null
          organization_id?: string
          phase?: Database["public"]["Enums"]["pulsar_phase"]
          started_at?: string
          task?: Database["public"]["Enums"]["pulsar_task"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulsar_entries_client_fk"
            columns: ["client_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pulsar_clients"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pulsar_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pulsar_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pulsar_settings: {
        Row: {
          created_at: string
          heures_pilotage_alerte: number
          organization_id: string
          taux_alerte_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          heures_pilotage_alerte?: number
          organization_id: string
          taux_alerte_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          heures_pilotage_alerte?: number
          organization_id?: string
          taux_alerte_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulsar_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_booking_activities: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          organization_id: string
          payload: Json
          type: string
          user_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          organization_id: string
          payload?: Json
          type: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radar_booking_activities_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_booking_activities_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_booking_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_booking_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_booking_answers: {
        Row: {
          answers: Json
          booking_id: string
          organization_id: string
          received_at: string
        }
        Insert: {
          answers: Json
          booking_id: string
          organization_id: string
          received_at?: string
        }
        Update: {
          answers?: Json
          booking_id?: string
          organization_id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_booking_answers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_booking_answers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_booking_answers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_bookings: {
        Row: {
          amount_cents: number
          attribution: Database["public"]["Enums"]["radar_attribution"]
          attribution_note: string | null
          attribution_source_id: string | null
          canceled_at: string | null
          channel_id: string | null
          closeuse_id: string | null
          created_at: string
          currency: string
          declared_source: string | null
          event_type_name: string
          event_type_uri: string | null
          event_uri: string
          id: string
          invitee_first_name: string
          invitee_key: string
          invitee_last_name: string
          invitee_uri: string
          organization_id: string
          payment_ok: boolean
          payment_ref: string | null
          rescheduled_from: string | null
          sale_amount_cents: number | null
          sale_date: string | null
          sale_fois: number
          sale_note: string | null
          sale_premier_cents: number | null
          sale_recorded_at: string | null
          sale_recorded_by: string | null
          scheduled_end: string
          scheduled_start: string
          statement_id: string | null
          status: Database["public"]["Enums"]["radar_status"]
          status_note: string | null
          status_origin: Database["public"]["Enums"]["radar_status_origin"]
          updated_at: string
          utm: Json
        }
        Insert: {
          amount_cents?: number
          attribution?: Database["public"]["Enums"]["radar_attribution"]
          attribution_note?: string | null
          attribution_source_id?: string | null
          canceled_at?: string | null
          channel_id?: string | null
          closeuse_id?: string | null
          created_at?: string
          currency?: string
          declared_source?: string | null
          event_type_name: string
          event_type_uri?: string | null
          event_uri: string
          id?: string
          invitee_first_name?: string
          invitee_key: string
          invitee_last_name?: string
          invitee_uri: string
          organization_id: string
          payment_ok?: boolean
          payment_ref?: string | null
          rescheduled_from?: string | null
          sale_amount_cents?: number | null
          sale_date?: string | null
          sale_fois?: number
          sale_note?: string | null
          sale_premier_cents?: number | null
          sale_recorded_at?: string | null
          sale_recorded_by?: string | null
          scheduled_end: string
          scheduled_start: string
          statement_id?: string | null
          status?: Database["public"]["Enums"]["radar_status"]
          status_note?: string | null
          status_origin?: Database["public"]["Enums"]["radar_status_origin"]
          updated_at?: string
          utm?: Json
        }
        Update: {
          amount_cents?: number
          attribution?: Database["public"]["Enums"]["radar_attribution"]
          attribution_note?: string | null
          attribution_source_id?: string | null
          canceled_at?: string | null
          channel_id?: string | null
          closeuse_id?: string | null
          created_at?: string
          currency?: string
          declared_source?: string | null
          event_type_name?: string
          event_type_uri?: string | null
          event_uri?: string
          id?: string
          invitee_first_name?: string
          invitee_key?: string
          invitee_last_name?: string
          invitee_uri?: string
          organization_id?: string
          payment_ok?: boolean
          payment_ref?: string | null
          rescheduled_from?: string | null
          sale_amount_cents?: number | null
          sale_date?: string | null
          sale_fois?: number
          sale_note?: string | null
          sale_premier_cents?: number | null
          sale_recorded_at?: string | null
          sale_recorded_by?: string | null
          scheduled_end?: string
          scheduled_start?: string
          statement_id?: string | null
          status?: Database["public"]["Enums"]["radar_status"]
          status_note?: string | null
          status_origin?: Database["public"]["Enums"]["radar_status_origin"]
          updated_at?: string
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "radar_bookings_attribution_source_id_fkey"
            columns: ["attribution_source_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_attribution_source_id_fkey"
            columns: ["attribution_source_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "radar_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_closeuse_id_fkey"
            columns: ["closeuse_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_sale_recorded_by_fkey"
            columns: ["sale_recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_statement_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "radar_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_channel_entries: {
        Row: {
          channel_id: string
          clicks: number
          id: string
          month: string
          note: string | null
          organization_id: string
          spend_cents: number
          visitors: number
        }
        Insert: {
          channel_id: string
          clicks?: number
          id?: string
          month: string
          note?: string | null
          organization_id: string
          spend_cents?: number
          visitors?: number
        }
        Update: {
          channel_id?: string
          clicks?: number
          id?: string
          month?: string
          note?: string | null
          organization_id?: string
          spend_cents?: number
          visitors?: number
        }
        Relationships: [
          {
            foreignKeyName: "radar_channel_entries_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "radar_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_channel_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_channels: {
        Row: {
          id: string
          is_active: boolean
          is_comete: boolean
          key: string
          label: string
          organization_id: string
          rules: Json
          sort_order: number
        }
        Insert: {
          id?: string
          is_active?: boolean
          is_comete?: boolean
          key: string
          label: string
          organization_id: string
          rules?: Json
          sort_order?: number
        }
        Update: {
          id?: string
          is_active?: boolean
          is_comete?: boolean
          key?: string
          label?: string
          organization_id?: string
          rules?: Json
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "radar_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_closeuses: {
        Row: {
          created_at: string
          organization_id: string
          palier_apres: number
          taux: number
          taux_palier: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          palier_apres?: number
          taux?: number
          taux_palier?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          palier_apres?: number
          taux?: number
          taux_palier?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_closeuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_closeuses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_encaissement_incidents: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          note: string | null
          numero: number
          organization_id: string
          type: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          note?: string | null
          numero: number
          organization_id: string
          type: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          note?: string | null
          numero?: number
          organization_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_encaissement_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_encaissement_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_encaissement_incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_encaissement_incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_event_filters: {
        Row: {
          closeuse_id: string | null
          event_type_name: string
          event_type_uri: string
          first_seen_at: string
          id: string
          organization_id: string
          tracked: boolean
          updated_at: string
        }
        Insert: {
          closeuse_id?: string | null
          event_type_name: string
          event_type_uri: string
          first_seen_at?: string
          id?: string
          organization_id: string
          tracked?: boolean
          updated_at?: string
        }
        Update: {
          closeuse_id?: string | null
          event_type_name?: string
          event_type_uri?: string
          first_seen_at?: string
          id?: string
          organization_id?: string
          tracked?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_event_filters_closeuse_id_fkey"
            columns: ["closeuse_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_event_filters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_export_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_used_at: string | null
          organization_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          last_used_at?: string | null
          organization_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          organization_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_export_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_settings: {
        Row: {
          calendly_org_uri: string | null
          calendly_user_uri: string | null
          calendly_webhook_uri: string | null
          commission_basis: Database["public"]["Enums"]["radar_commission_basis"]
          commission_rate: number
          connected_at: string | null
          created_at: string
          currency: string
          last_webhook_at: string | null
          organization_id: string
          suivi_appel_veille: boolean
          updated_at: string
          window_days: number
        }
        Insert: {
          calendly_org_uri?: string | null
          calendly_user_uri?: string | null
          calendly_webhook_uri?: string | null
          commission_basis?: Database["public"]["Enums"]["radar_commission_basis"]
          commission_rate?: number
          connected_at?: string | null
          created_at?: string
          currency?: string
          last_webhook_at?: string | null
          organization_id: string
          suivi_appel_veille?: boolean
          updated_at?: string
          window_days?: number
        }
        Update: {
          calendly_org_uri?: string | null
          calendly_user_uri?: string | null
          calendly_webhook_uri?: string | null
          commission_basis?: Database["public"]["Enums"]["radar_commission_basis"]
          commission_rate?: number
          connected_at?: string | null
          created_at?: string
          currency?: string
          last_webhook_at?: string | null
          organization_id?: string
          suivi_appel_veille?: boolean
          updated_at?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "radar_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_settings_log: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          payload: Json
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          payload?: Json
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "radar_settings_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_settings_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_statements: {
        Row: {
          base_cents: number
          closed_at: string
          commission_basis: Database["public"]["Enums"]["radar_commission_basis"]
          commission_cents: number
          commission_rate: number
          id: string
          lines: Json
          month: string
          organization_id: string
          paid_at: string | null
          review_comment: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["radar_statement_status"]
          window_days: number
        }
        Insert: {
          base_cents?: number
          closed_at?: string
          commission_basis?: Database["public"]["Enums"]["radar_commission_basis"]
          commission_cents?: number
          commission_rate: number
          id?: string
          lines?: Json
          month: string
          organization_id: string
          paid_at?: string | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["radar_statement_status"]
          window_days: number
        }
        Update: {
          base_cents?: number
          closed_at?: string
          commission_basis?: Database["public"]["Enums"]["radar_commission_basis"]
          commission_cents?: number
          commission_rate?: number
          id?: string
          lines?: Json
          month?: string
          organization_id?: string
          paid_at?: string | null
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["radar_statement_status"]
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "radar_statements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_statements_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_webhook_log: {
        Row: {
          event_kind: string | null
          id: string
          invitee_key: string | null
          message: string | null
          organization_id: string | null
          outcome: string
          received_at: string
        }
        Insert: {
          event_kind?: string | null
          id?: string
          invitee_key?: string | null
          message?: string | null
          organization_id?: string | null
          outcome: string
          received_at?: string
        }
        Update: {
          event_kind?: string | null
          id?: string
          invitee_key?: string | null
          message?: string | null
          organization_id?: string | null
          outcome?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_webhook_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sas_boxes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sas_boxes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sas_boxes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sas_notes: {
        Row: {
          archived_at: string | null
          box_id: string | null
          captured_at: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_archived: boolean
          organization_id: string
          realm: Database["public"]["Enums"]["sas_realm"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          box_id?: string | null
          captured_at?: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          organization_id: string
          realm: Database["public"]["Enums"]["sas_realm"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          box_id?: string | null
          captured_at?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_archived?: boolean
          organization_id?: string
          realm?: Database["public"]["Enums"]["sas_realm"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sas_notes_box_id_fkey"
            columns: ["box_id"]
            isOneToOne: false
            referencedRelation: "sas_boxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sas_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sas_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sonde_daily: {
        Row: {
          channel_bucket: string
          channel_id: string | null
          cta_clicks: number
          day: string
          organization_id: string
          pageviews: number
          site_id: string
          slot_picks: number
          visitors: number
        }
        Insert: {
          channel_bucket: string
          channel_id?: string | null
          cta_clicks?: number
          day: string
          organization_id: string
          pageviews?: number
          site_id: string
          slot_picks?: number
          visitors?: number
        }
        Update: {
          channel_bucket?: string
          channel_id?: string | null
          cta_clicks?: number
          day?: string
          organization_id?: string
          pageviews?: number
          site_id?: string
          slot_picks?: number
          visitors?: number
        }
        Relationships: [
          {
            foreignKeyName: "sonde_daily_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "radar_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sonde_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sonde_daily_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sonde_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sonde_events: {
        Row: {
          channel_bucket: string
          channel_id: string | null
          id: number
          kind: Database["public"]["Enums"]["sonde_event_kind"]
          occurred_at: string
          organization_id: string
          path: string
          referrer_host: string | null
          site_id: string
          utm: Json
          visitor_key: string
        }
        Insert: {
          channel_bucket?: string
          channel_id?: string | null
          id?: never
          kind: Database["public"]["Enums"]["sonde_event_kind"]
          occurred_at?: string
          organization_id: string
          path?: string
          referrer_host?: string | null
          site_id: string
          utm?: Json
          visitor_key: string
        }
        Update: {
          channel_bucket?: string
          channel_id?: string | null
          id?: never
          kind?: Database["public"]["Enums"]["sonde_event_kind"]
          occurred_at?: string
          organization_id?: string
          path?: string
          referrer_host?: string | null
          site_id?: string
          utm?: Json
          visitor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sonde_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "radar_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sonde_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sonde_events_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sonde_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sonde_salt: {
        Row: {
          day: string
          salt: string
        }
        Insert: {
          day: string
          salt: string
        }
        Update: {
          day?: string
          salt?: string
        }
        Relationships: []
      }
      sonde_sites: {
        Row: {
          created_at: string
          domains: string[]
          id: string
          is_active: boolean
          last_event_at: string | null
          name: string
          organization_id: string
          token: string
        }
        Insert: {
          created_at?: string
          domains?: string[]
          id?: string
          is_active?: boolean
          last_event_at?: string | null
          name: string
          organization_id: string
          token?: string
        }
        Update: {
          created_at?: string
          domains?: string[]
          id?: string
          is_active?: boolean
          last_event_at?: string | null
          name?: string
          organization_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "sonde_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          created_at: string
          description: string
          href: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["tool_kind"]
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          href?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["tool_kind"]
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          href?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["tool_kind"]
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      radar_bookings_effective: {
        Row: {
          amount_cents: number | null
          attribution: Database["public"]["Enums"]["radar_attribution"] | null
          attribution_note: string | null
          attribution_source_id: string | null
          canceled_at: string | null
          channel_id: string | null
          closeuse_id: string | null
          commission_basis:
            | Database["public"]["Enums"]["radar_commission_basis"]
            | null
          commission_month: string | null
          counts_for_commission: boolean | null
          created_at: string | null
          currency: string | null
          declared_source: string | null
          effective_status: Database["public"]["Enums"]["radar_status"] | null
          event_type_name: string | null
          event_type_uri: string | null
          event_uri: string | null
          has_sale: boolean | null
          id: string | null
          invitee_display: string | null
          invitee_first_name: string | null
          invitee_key: string | null
          invitee_last_name: string | null
          invitee_uri: string | null
          mois: string | null
          organization_id: string | null
          payment_ok: boolean | null
          payment_ref: string | null
          rescheduled_from: string | null
          sale_amount_cents: number | null
          sale_date: string | null
          sale_fois: number | null
          sale_note: string | null
          sale_recorded_at: string | null
          sale_recorded_by: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          statement_id: string | null
          status: Database["public"]["Enums"]["radar_status"] | null
          status_note: string | null
          status_origin:
            | Database["public"]["Enums"]["radar_status_origin"]
            | null
          updated_at: string | null
          utm: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "radar_bookings_attribution_source_id_fkey"
            columns: ["attribution_source_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_attribution_source_id_fkey"
            columns: ["attribution_source_id"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "radar_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_closeuse_id_fkey"
            columns: ["closeuse_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "radar_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "radar_bookings_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_sale_recorded_by_fkey"
            columns: ["sale_recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_bookings_statement_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "radar_statements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      agent_clear_secrets: { Args: { org: string }; Returns: number }
      agent_get_secret: { Args: { kind: string; org: string }; Returns: string }
      agent_horloge: { Args: never; Returns: number }
      agent_horloge_couper: { Args: never; Returns: number }
      agent_horloge_regler: {
        Args: { secret: string; url: string }
        Returns: undefined
      }
      agent_purger_conversations: { Args: never; Returns: number }
      agent_set_secret: {
        Args: { kind: string; org: string; value: string }
        Returns: undefined
      }
      can_access_board: { Args: { b: string }; Returns: boolean }
      can_access_files: { Args: { org: string }; Returns: boolean }
      can_access_files_path: { Args: { object_name: string }; Returns: boolean }
      can_access_finances: { Args: { org: string }; Returns: boolean }
      can_access_radar: { Args: { org: string }; Returns: boolean }
      can_access_sas: { Args: { org: string }; Returns: boolean }
      can_access_sonde: { Args: { org: string }; Returns: boolean }
      can_access_temps: { Args: { org: string }; Returns: boolean }
      est_auteur_objet: {
        Args: { owner: string; owner_id: string }
        Returns: boolean
      }
      has_tool: { Args: { org: string; tool_slug: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_closeuse: { Args: { org: string }; Returns: boolean }
      is_member: { Args: { org: string }; Returns: boolean }
      is_org_owner: { Args: { org: string }; Returns: boolean }
      org_du_chemin: { Args: { object_name: string }; Returns: string }
      radar_clear_secrets: { Args: { org: string }; Returns: number }
      radar_client_set_status: {
        Args: {
          booking_id: string
          new_status: Database["public"]["Enums"]["radar_status"]
          note?: string
        }
        Returns: undefined
      }
      radar_decline_sale: { Args: { booking_id: string }; Returns: boolean }
      radar_get_secret: { Args: { kind: string; org: string }; Returns: string }
      radar_mois: { Args: { quand: string }; Returns: string }
      radar_note_appel: {
        Args: { booking_id: string; reponse: string }
        Returns: boolean
      }
      radar_note_non_vente: {
        Args: {
          booking_id: string
          motif: string
          recontacter?: string
          recontacter_le?: string
        }
        Returns: boolean
      }
      radar_peut_saisir: {
        Args: { closeuse: string; org: string }
        Returns: boolean
      }
      radar_purger_identite: {
        Args: { avec_vente?: string; sans_vente?: string }
        Returns: number
      }
      radar_purger_journal: { Args: { anciennete?: string }; Returns: number }
      radar_purger_rendezvous: {
        Args: { anciennete?: string }
        Returns: number
      }
      radar_purger_reponses: { Args: { anciennete?: string }; Returns: number }
      radar_recontact_fait: { Args: { booking_id: string }; Returns: boolean }
      radar_review_statement: {
        Args: {
          comment?: string
          decision: Database["public"]["Enums"]["radar_statement_status"]
          statement_id: string
        }
        Returns: undefined
      }
      radar_secrets_restants: { Args: { org: string }; Returns: number }
      radar_set_sale: {
        Args: {
          amount_cents?: number
          booking_id: string
          note?: string
          sale_date?: string
        }
        Returns: undefined
      }
      radar_set_sale_fois: {
        Args: { booking_id: string; fois: number; premier_cents?: number }
        Returns: undefined
      }
      radar_set_secret: {
        Args: { kind: string; org: string; value: string }
        Returns: undefined
      }
      radar_supprimer_lignes_du_type: {
        Args: { filtre: string }
        Returns: {
          figees: number
          supprimees: number
        }[]
      }
      sas_compteurs: {
        Args: { org: string }
        Returns: {
          box_id: string
          derniere: string
          notes: number
          realm: Database["public"]["Enums"]["sas_realm"]
        }[]
      }
      shares_org_with: { Args: { other: string }; Returns: boolean }
      sonde_agreger_jour: { Args: { cible?: string }; Returns: number }
      sonde_purger_evenements: {
        Args: { anciennete?: string }
        Returns: number
      }
      sonde_tourner_sel: { Args: never; Returns: string }
      stats_fichiers: {
        Args: { org?: string }
        Returns: {
          fichiers: number
          octets: number
        }[]
      }
    }
    Enums: {
      file_status: "uploading" | "ready"
      membership_role: "owner" | "member" | "closeuse"
      pulsar_modele: "recurrent" | "one_shot" | "commission" | "historique"
      pulsar_phase: "setup" | "pilotage" | "interne"
      pulsar_profil: "p1" | "p2" | "p3" | "hors_cible"
      pulsar_statut: "setup" | "pilotage" | "termine"
      pulsar_task:
        | "site"
        | "ads"
        | "emails"
        | "tracking"
        | "reunion"
        | "seo"
        | "prospection"
        | "admin"
      radar_attribution: "utm" | "recurrence" | "direct" | "manuel"
      radar_commission_basis: "encaissement" | "ventes"
      radar_statement_status: "cloture" | "conteste" | "valide" | "paye"
      radar_status: "confirme" | "honore" | "annule" | "no_show"
      radar_status_origin: "calendly" | "auto" | "client" | "admin"
      sas_realm: "pro" | "perso"
      sonde_event_kind: "pageview" | "cta" | "creneau"
      tool_kind: "internal" | "external"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      file_status: ["uploading", "ready"],
      membership_role: ["owner", "member", "closeuse"],
      pulsar_modele: ["recurrent", "one_shot", "commission", "historique"],
      pulsar_phase: ["setup", "pilotage", "interne"],
      pulsar_profil: ["p1", "p2", "p3", "hors_cible"],
      pulsar_statut: ["setup", "pilotage", "termine"],
      pulsar_task: [
        "site",
        "ads",
        "emails",
        "tracking",
        "reunion",
        "seo",
        "prospection",
        "admin",
      ],
      radar_attribution: ["utm", "recurrence", "direct", "manuel"],
      radar_commission_basis: ["encaissement", "ventes"],
      radar_statement_status: ["cloture", "conteste", "valide", "paye"],
      radar_status: ["confirme", "honore", "annule", "no_show"],
      radar_status_origin: ["calendly", "auto", "client", "admin"],
      sas_realm: ["pro", "perso"],
      sonde_event_kind: ["pageview", "cta", "creneau"],
      tool_kind: ["internal", "external"],
    },
  },
} as const
