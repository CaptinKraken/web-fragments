import { component$, PropsOf, QRL, Signal, Slot } from "@builder.io/qwik";
// import { Heading } from '../heading';
// import { IconButton } from '../button';
import { HModalRoot } from "./Root";
import { HModalPanel } from "./Panel";

type ModalProps = PropsOf<typeof HModalRoot> & {
	title: string;
	isOpen: Signal<boolean>;
	onClose$: QRL<() => void>;
};

export const Modal = component$<ModalProps>(
	({ title, isOpen, onClose$, ...props }) => {
		return (
			<HModalRoot bind:show={isOpen} onClose$={onClose$} {...props}>
				<HModalPanel class="min-w-[45ch] rounded bg-neutral p-sm text-neutral">
					<div class="mb-sm flex items-center justify-between">
						{/* <Heading level={2}>{title}</Heading> */}
						{title}
						<button onClick$={onClose$}>X</button>
					</div>
					<Slot name="body" />
					<footer class="mt-sm">
						<Slot name="footer" />
					</footer>
				</HModalPanel>
			</HModalRoot>
		);
	}
);
